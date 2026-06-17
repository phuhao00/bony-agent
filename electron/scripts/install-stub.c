/*
 * Mach-O launcher for Install AI Media Agent.app
 * macOS Gatekeeper rejects .app bundles whose CFBundleExecutable is a shell script.
 */
#include <mach-o/dyld.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

static void trim_to_parent(char *path) {
  char *slash = strrchr(path, '/');
  if (slash) *slash = '\0';
}

int main(int argc, char *argv[]) {
  char exec_path[PATH_MAX];
  uint32_t size = sizeof(exec_path);
  if (_NSGetExecutablePath(exec_path, &size) != 0) return 1;

  char contents_path[PATH_MAX];
  strncpy(contents_path, exec_path, PATH_MAX - 1);
  contents_path[PATH_MAX - 1] = '\0';
  trim_to_parent(contents_path); /* .../Contents/MacOS */
  trim_to_parent(contents_path); /* .../Contents */

  char script_path[PATH_MAX];
  snprintf(script_path, sizeof(script_path), "%s/Resources/install.sh", contents_path);

  execl("/bin/bash", "bash", script_path, (char *)NULL);
  perror("install-stub");
  return 1;
}
