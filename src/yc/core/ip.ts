export function ipToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

export function parseCidr(cidr: string) {
  const [ip, maskStr] = cidr.split("/");
  const maskBits = Number(maskStr);
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
  return { network: ipToInt(ip) & mask, mask };
}

export function isIpInRanges(ip: string, cidrs: string[]): boolean {
  return cidrs.some((cidr) => {
    const { network, mask } = parseCidr(cidr);
    return (ipToInt(ip) & mask) === network;
  });
}
