const COOLDOWNS = Object.freeze({
  RATE_LIMIT: 15 * 60 * 1000,
  AUTH_OR_PERMISSION: 60 * 60 * 1000,
  TRANSIENT: 30 * 1000,
  PROVIDER_ERROR: 30 * 1000
});

function parseConfiguredKeys(env = process.env) {
  const raw = env.TWELVE_DATA_API_KEYS || "";
  let parsed = [];
  if (raw.trim()) {
    try {
      const value = JSON.parse(raw);
      parsed = Array.isArray(value) ? value : [value];
    } catch {
      parsed = raw.split(/[,;\s]+/);
    }
  }
  if (!parsed.length) {
    for (let i = 1; i <= 10; i++) {
      if (env[`TWELVE_DATA_API_KEY_${i}`]) parsed.push(env[`TWELVE_DATA_API_KEY_${i}`]);
    }
  }
  if (!parsed.length && env.TWELVE_DATA_API_KEY) parsed.push(env.TWELVE_DATA_API_KEY);
  return [...new Set(parsed.map(value => String(value ?? "").trim()).filter(Boolean))];
}

export class TwelveDataKeyPool {
  constructor(keys = parseConfiguredKeys()) {
    this.keys = [...new Set(keys.map(value => String(value ?? "").trim()).filter(Boolean))];
    this.activeIndex = 0;
    this.restIndex = 0;
    this.cooldowns = new Map();
    this.failures = new Map();
    this.lastError = null;
  }

  get keyCount() { return this.keys.length; }

  getCandidates() {
    if (!this.keys.length) return [];
    const now = Date.now();
    const ordered = this.keys.map((key, index) => ({ key, index }))
      .sort((a, b) => ((a.index - this.activeIndex + this.keys.length) % this.keys.length) -
                      ((b.index - this.activeIndex + this.keys.length) % this.keys.length));
    return ordered.filter(item => (this.cooldowns.get(item.key) || 0) <= now)
      .map(item => item.key);
  }

  getActiveKey() {
    const candidates = this.getCandidates();
    return candidates[0] || null;
  }

  getRestCandidates() {
    if (!this.keys.length) return [];
    const now = Date.now();
    return this.keys.map((key, index) => ({ key, index }))
      .sort((a, b) => ((a.index - this.restIndex + this.keys.length) % this.keys.length) -
                      ((b.index - this.restIndex + this.keys.length) % this.keys.length))
      .filter(item => (this.cooldowns.get(item.key) || 0) <= now)
      .map(item => item.key);
  }

  markRestSuccess(key) {
    if (!key) return;
    this.cooldowns.delete(key);
    this.failures.delete(key);
    const index = this.keys.indexOf(key);
    if (index >= 0) this.restIndex = (index + 1) % this.keys.length;
    this.lastError = null;
  }

  markSuccess(key) {
    if (!key) return;
    this.cooldowns.delete(key);
    this.failures.delete(key);
    const index = this.keys.indexOf(key);
    if (index >= 0) this.activeIndex = index;
    this.lastError = null;
  }

  markFailure(key, error) {
    if (!key) return;
    const kind = error?.kind || "TRANSIENT";
    const cooldown = COOLDOWNS[kind] || COOLDOWNS.TRANSIENT;
    this.cooldowns.set(key, Date.now() + cooldown);
    this.failures.set(key, (this.failures.get(key) || 0) + 1);
    const index = this.keys.indexOf(key);
    if (index >= 0 && this.keys.length) {
      this.activeIndex = (index + 1) % this.keys.length;
      this.restIndex = (index + 1) % this.keys.length;
    }
    this.lastError = { kind, message: String(error?.message || error || "Provider error") };
  }

  nextAvailableInMs() {
    if (!this.keys.length) return null;
    const now = Date.now();
    const available = this.getCandidates();
    if (available.length) return 0;
    const earliest = Math.min(...this.keys.map(key => this.cooldowns.get(key) || now));
    return Math.max(1000, earliest - now);
  }

  publicStatus() {
    const now = Date.now();
    const availableCount = this.keys.filter(key => (this.cooldowns.get(key) || 0) <= now).length;
    const activeKey = this.getActiveKey();
    const nextRestKey = this.getRestCandidates()[0] || null;
    return {
      configured: this.keys.length > 0,
      configuredCount: this.keys.length,
      availableCount,
      activeKeyNumber: activeKey ? this.keys.indexOf(activeKey) + 1 : null,
      keyStates: this.keys.map((credential, index) => {
        const until = this.cooldowns.get(credential) || 0;
        const available = until <= now;
        return { number: index + 1, status: !available ? "COOLDOWN" : credential === activeKey ? "ACTIVE" : "READY", available, cooldownRemainingMs: Math.max(0, until - now), failures: this.failures.get(credential) || 0 };
      }),
      rotation: this.keys.length > 1 ? "FAILOVER_POOL" : this.keys.length === 1 ? "SINGLE_KEY" : "UNCONFIGURED",
      restRotation: this.keys.length > 1 ? "ROUND_ROBIN" : this.keys.length === 1 ? "SINGLE_KEY" : "UNCONFIGURED",
      nextRestKeyNumber: nextRestKey ? this.keys.indexOf(nextRestKey) + 1 : null,
      lastFailure: this.lastError ? { kind: this.lastError.kind, message: this.lastError.message } : null
    };
  }
}

export const twelveDataKeyPool = new TwelveDataKeyPool();
