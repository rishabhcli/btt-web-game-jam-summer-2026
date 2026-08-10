#include <errno.h>
#include <limits.h>
#include <libproc.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/proc.h>
#include <sys/proc_info.h>

#define PID_BATCH_CAPACITY 4096U
#define DISCOVERED_PID_LIMIT 65536U

static int append_unique(pid_t **values, size_t *count, size_t *capacity,
                         pid_t candidate) {
  if (candidate <= 0) {
    return 0;
  }
  for (size_t index = 0U; index < *count; index += 1U) {
    if ((*values)[index] == candidate) {
      return 0;
    }
  }
  if (*count >= DISCOVERED_PID_LIMIT) {
    fputs("target process tree exceeded the discovery limit\n", stderr);
    return -1;
  }
  if (*count == *capacity) {
    size_t next_capacity = *capacity * 2U;
    if (next_capacity > DISCOVERED_PID_LIMIT) {
      next_capacity = DISCOVERED_PID_LIMIT;
    }
    pid_t *next_values = realloc(*values, next_capacity * sizeof(pid_t));
    if (next_values == NULL) {
      fputs("target process-tree allocation failed\n", stderr);
      return -1;
    }
    *values = next_values;
    *capacity = next_capacity;
  }
  (*values)[*count] = candidate;
  *count += 1U;
  return 1;
}

static int parse_pid(const char *source, pid_t *result) {
  char *end = NULL;
  errno = 0;
  long value = strtol(source, &end, 10);
  if (errno != 0 || end == source || *end != '\0' || value <= 0L ||
      value > INT_MAX) {
    return -1;
  }
  *result = (pid_t)value;
  return 0;
}

static int append_pid_batch(pid_t **discovered, size_t *discovered_count,
                            size_t *discovered_capacity, const pid_t *batch,
                            int batch_count) {
  if (batch_count < 0 || (size_t)batch_count >= PID_BATCH_CAPACITY) {
    fputs("native PID batch was truncated\n", stderr);
    return -1;
  }
  for (int index = 0; index < batch_count; index += 1) {
    if (append_unique(discovered, discovered_count, discovered_capacity,
                      batch[index]) < 0) {
      return -1;
    }
  }
  return 0;
}

static int allow_disappeared_process(int result) {
  if (result >= 0) {
    return result;
  }
  if (errno == ESRCH || errno == ENOENT) {
    return 0;
  }
  return result;
}

int main(int argument_count, char **arguments) {
  if (argument_count < 2) {
    fputs("usage: owned-process-snapshot ROOT_PID [TRACKED_PID ...]\n",
          stderr);
    return 2;
  }
  pid_t root_pid;
  if (parse_pid(arguments[1], &root_pid) != 0) {
    fputs("root PID is invalid\n", stderr);
    return 3;
  }

  size_t discovered_capacity = 512U;
  size_t discovered_count = 0U;
  pid_t *discovered = calloc(discovered_capacity, sizeof(pid_t));
  pid_t *batch = calloc(PID_BATCH_CAPACITY, sizeof(pid_t));
  if (discovered == NULL || batch == NULL) {
    fputs("process-tree allocation failed\n", stderr);
    free(discovered);
    free(batch);
    return 4;
  }

  for (int index = 1; index < argument_count; index += 1) {
    pid_t seed;
    if (parse_pid(arguments[index], &seed) != 0 ||
        append_unique(&discovered, &discovered_count, &discovered_capacity,
                      seed) < 0) {
      fputs("tracked PID is invalid\n", stderr);
      free(discovered);
      free(batch);
      return 5;
    }
  }

  errno = 0;
  int group_count = allow_disappeared_process(proc_listpgrppids(
      root_pid, batch, (int)(PID_BATCH_CAPACITY * sizeof(pid_t))));
  if (append_pid_batch(&discovered, &discovered_count, &discovered_capacity,
                       batch, group_count) != 0) {
    free(discovered);
    free(batch);
    return 6;
  }

  for (size_t parent_index = 0U; parent_index < discovered_count;
       parent_index += 1U) {
    errno = 0;
    int child_count = allow_disappeared_process(proc_listchildpids(
        discovered[parent_index], batch,
        (int)(PID_BATCH_CAPACITY * sizeof(pid_t))));
    if (append_pid_batch(&discovered, &discovered_count,
                         &discovered_capacity, batch, child_count) != 0) {
      free(discovered);
      free(batch);
      return 7;
    }
  }

  size_t emitted = 0U;
  for (size_t index = 0U; index < discovered_count; index += 1U) {
    struct proc_bsdinfo information;
    const int observed =
        proc_pidinfo(discovered[index], PROC_PIDTBSDINFO, 0, &information,
                     sizeof(information));
    if (observed != (int)sizeof(information) || information.pbi_pid == 0U) {
      continue;
    }
    const char state = information.pbi_status == SZOMB ? 'Z' : 'L';
    printf("%u\t%u\t%u\t%c\t%llu.%06llu\n", information.pbi_pid,
           information.pbi_ppid, information.pbi_pgid, state,
           (unsigned long long)information.pbi_start_tvsec,
           (unsigned long long)information.pbi_start_tvusec);
    emitted += 1U;
  }

  printf("#complete\tseeds=%d\tdiscovered=%zu\temitted=%zu\tbatch_capacity=%u\n",
         argument_count - 1, discovered_count, emitted, PID_BATCH_CAPACITY);
  free(discovered);
  free(batch);
  if (fflush(stdout) != 0) {
    fprintf(stderr, "process-tree flush failed: %d\n", errno);
    return 8;
  }
  return 0;
}
