#include <arpa/inet.h>
#include <libproc.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/proc_info.h>
#include <sys/types.h>

static int print_listening_sockets(pid_t pid) {
  int descriptor_bytes = proc_pidinfo(pid, PROC_PIDLISTFDS, 0, NULL, 0);
  if (descriptor_bytes <= 0) {
    return 0;
  }

  descriptor_bytes += (int)(32 * sizeof(struct proc_fdinfo));
  struct proc_fdinfo *descriptors = NULL;
  int actual_bytes = 0;
  int descriptor_list_complete = 0;
  for (int attempt = 0; attempt < 3; attempt += 1) {
    if (descriptor_bytes <= 0 || descriptor_bytes > 4 * 1024 * 1024) {
      free(descriptors);
      return -1;
    }
    struct proc_fdinfo *replacement =
        realloc(descriptors, (size_t)descriptor_bytes);
    if (replacement == NULL) {
      free(descriptors);
      return -1;
    }
    descriptors = replacement;
    actual_bytes = proc_pidinfo(pid, PROC_PIDLISTFDS, 0, descriptors,
                                descriptor_bytes);
    if (actual_bytes <= 0) {
      free(descriptors);
      return 0;
    }
    if (actual_bytes < descriptor_bytes) {
      descriptor_list_complete = 1;
      break;
    }
    descriptor_bytes *= 2;
  }
  if (!descriptor_list_complete) {
    free(descriptors);
    return -1;
  }

  int descriptor_count = actual_bytes / (int)sizeof(struct proc_fdinfo);
  for (int index = 0; index < descriptor_count; index += 1) {
    if (descriptors[index].proc_fdtype != PROX_FDTYPE_SOCKET) {
      continue;
    }

    struct socket_fdinfo socket_info;
    memset(&socket_info, 0, sizeof(socket_info));
    int socket_bytes = proc_pidfdinfo(
        pid, descriptors[index].proc_fd, PROC_PIDFDSOCKETINFO, &socket_info,
        (int)sizeof(socket_info));
    if (socket_bytes != (int)sizeof(socket_info) ||
        socket_info.psi.soi_kind != SOCKINFO_TCP) {
      continue;
    }

    struct tcp_sockinfo *tcp_info = &socket_info.psi.soi_proto.pri_tcp;
    if (tcp_info->tcpsi_state != TSI_S_LISTEN) {
      continue;
    }

    const struct in_sockinfo *internet_info = &tcp_info->tcpsi_ini;
    const void *address_source = NULL;
    const char *protocol = NULL;
    int family = 0;
    /* Fail closed for dual-stack or mapped sockets: if the kernel marks the
       descriptor as IPv6 at all, report it as IPv6 so the loopback contract
       rejects it rather than treating it as an IPv4-only listener. */
    if ((internet_info->insi_vflag & INI_IPV6) != 0) {
      address_source = &internet_info->insi_laddr.ina_6;
      family = AF_INET6;
      protocol = "tcp6";
    } else if ((internet_info->insi_vflag & INI_IPV4) != 0) {
      address_source = &internet_info->insi_laddr.ina_46.i46a_addr4;
      family = AF_INET;
      protocol = "tcp4";
    } else {
      continue;
    }

    char address[INET6_ADDRSTRLEN];
    if (inet_ntop(family, address_source, address, sizeof(address)) == NULL) {
      continue;
    }
    unsigned int port =
        (unsigned int)ntohs((uint16_t)internet_info->insi_lport);
    if (printf("%d\t%s\t%s\t%u\n", pid, protocol, address, port) < 0) {
      free(descriptors);
      return -1;
    }
  }

  free(descriptors);
  return 0;
}

int main(void) {
  int capacity = proc_listallpids(NULL, 0);
  if (capacity <= 0) {
    return 2;
  }
  capacity += 256;

  pid_t *processes = calloc((size_t)capacity, sizeof(pid_t));
  if (processes == NULL) {
    return 3;
  }
  int process_count =
      proc_listallpids(processes, capacity * (int)sizeof(pid_t));
  if (process_count < 0 || process_count >= capacity) {
    free(processes);
    return 4;
  }

  for (int index = 0; index < process_count; index += 1) {
    if (processes[index] <= 1) {
      continue;
    }
    if (print_listening_sockets(processes[index]) != 0) {
      free(processes);
      return 5;
    }
  }

  free(processes);
  return 0;
}
