export function navigate(section: "settings" | "ips" | "vms" | "logs", setActive: (s: any) => void) {
  setActive(section);
}
