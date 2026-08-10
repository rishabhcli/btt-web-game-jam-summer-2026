#include <errno.h>
#include <libproc.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/proc_info.h>

int main(int argc, char **argv) {
  if (argc != 2) return 64;
  char *end = NULL;
  errno = 0;
  long parsed = strtol(argv[1], &end, 10);
  if (errno != 0 || end == argv[1] || *end != '\0' || parsed <= 1 || parsed > INT_MAX) {
    return 64;
  }
  struct proc_vnodepathinfo paths;
  int received = proc_pidinfo((int)parsed, PROC_PIDVNODEPATHINFO, 0, &paths, sizeof(paths));
  if (received != (int)sizeof(paths) || paths.pvi_cdir.vip_path[0] == '\0') return 69;
  if (puts(paths.pvi_cdir.vip_path) == EOF) return 74;
  return 0;
}
