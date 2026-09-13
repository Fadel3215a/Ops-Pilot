import type { Response } from 'playwright';
import type { ScanPayloadBreakdown, ScanThirdParty } from './types';

type PayloadKind = keyof ScanPayloadBreakdown;

const KIND_BY_RESOURCE_TYPE: Partial<Record<string, PayloadKind>> = {
  script: 'javascript',
  stylesheet: 'css',
  image: 'image',
  font: 'font',
};

function rootDomain(host: string): string {
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  return parts.slice(parts.length - 2).join('.');
}

export interface NetworkStats {
  thirdParty: ScanThirdParty;
  payloadBytesByType: ScanPayloadBreakdown;
  totalPayloadBytes: number;
}

export class NetworkMonitor {
  private readonly primaryHost: string;
  private readonly primaryRegistrable: string;
  private readonly firstPartyHosts = new Set<string>();
  private readonly thirdPartyHosts = new Set<string>();
  private thirdPartyScriptCount = 0;
  private thirdPartyPayloadBytes = 0;
  private readonly bytesByType: ScanPayloadBreakdown = { javascript: 0, css: 0, image: 0, font: 0 };
  private totalPayloadBytes = 0;

  constructor(mainUrl: string) {
    const hostname = new URL(mainUrl).hostname;
    this.primaryHost = hostname;
    this.primaryRegistrable = rootDomain(hostname);
    this.firstPartyHosts.add(hostname);
  }

  private isThirdParty(hostname: string): boolean {
    if (this.firstPartyHosts.has(hostname)) return false;
    return hostname !== this.primaryRegistrable && !hostname.endsWith(`.${this.primaryRegistrable}`);
  }

  async record(response: Response): Promise<void> {
    const resourceType = response.request().resourceType();
    const kind = KIND_BY_RESOURCE_TYPE[resourceType];
    if (!kind) return;

    let hostname: string;
    try {
      hostname = new URL(response.url()).hostname;
    } catch {
      return;
    }

    const thirdParty = this.isThirdParty(hostname);
    if (thirdParty) this.thirdPartyHosts.add(hostname);

    const headers = response.headers();
    const contentLength = headers['content-length'];
    let bytes = 0;
    if (contentLength !== undefined && /^\d+$/.test(contentLength)) {
      bytes = parseInt(contentLength, 10);
    } else {
      try {
        bytes = (await response.body()).byteLength;
      } catch {
        bytes = 0;
      }
    }

    this.bytesByType[kind] += bytes;
    this.totalPayloadBytes += bytes;

    if (thirdParty) {
      this.thirdPartyPayloadBytes += bytes;
      if (kind === 'javascript') this.thirdPartyScriptCount += 1;
    }
  }

  getStats(): NetworkStats {
    return {
      thirdParty: {
        scriptCount: this.thirdPartyScriptCount,
        payloadBytes: this.thirdPartyPayloadBytes,
        domains: Array.from(this.thirdPartyHosts).sort(),
      },
      payloadBytesByType: { ...this.bytesByType },
      totalPayloadBytes: this.totalPayloadBytes,
    };
  }
}