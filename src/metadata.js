'use strict';

// Reads EC2 instance metadata using IMDSv2 (token-based). Beanstalk instances
// are plain EC2 instances, so this tells you exactly which machine served a request.
const BASE = 'http://169.254.169.254/latest';
const RETRY_AFTER_MS = 30_000;

let cache = { onAws: false, checked: false };
let cachedAt = 0;
let inflight = null;

async function fetchText(url, options = {}) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(500) });
  if (!res.ok) throw new Error(`IMDS returned ${res.status}`);
  return res.text();
}

async function load() {
  if (process.env.DISABLE_IMDS === 'true') return { onAws: false, checked: true };
  try {
    const token = await fetchText(`${BASE}/api/token`, {
      method: 'PUT',
      headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '21600' }
    });
    const get = (key) =>
      fetchText(`${BASE}/meta-data/${key}`, { headers: { 'X-aws-ec2-metadata-token': token } }).catch(() => null);
    const keys = ['instance-id', 'instance-type', 'placement/availability-zone', 'placement/region', 'local-ipv4', 'public-ipv4', 'ami-id'];
    const [instanceId, instanceType, availabilityZone, region, privateIp, publicIp, amiId] = await Promise.all(keys.map(get));
    return { onAws: true, checked: true, instanceId, instanceType, availabilityZone, region, privateIp, publicIp, amiId };
  } catch {
    return { onAws: false, checked: true };
  }
}

async function get() {
  const fresh = cache.checked && (cache.onAws || Date.now() - cachedAt < RETRY_AFTER_MS);
  if (fresh) return cache;
  if (!inflight) {
    inflight = load().then((result) => {
      cache = result;
      cachedAt = Date.now();
      inflight = null;
      return result;
    });
  }
  return inflight;
}

const cached = () => cache;

module.exports = { get, cached };
