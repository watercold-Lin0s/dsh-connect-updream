/**
 * Account storage: the multi-key layer above the credential vault.
 *
 * Updream has no notion of "sign in as" — an API key IS an account. One key
 * belongs to exactly one user, and the only way to act as a different user is
 * to send a different key. So account switching here means keeping several keys
 * on disk and choosing which one requests use.
 *
 * Layout, all inside the credential vault (never in config, never in a page):
 *
 *   dsh-connect-updream/account-<uuid>   { kind: 'api-key', key: 'sk-…',
 *                                          env: { label, upstreamId, username } }
 *   dsh-connect-updream/active           { kind: 'api-key', key: '<uuid>' }   (alias pointer)
 *
 * The alias pointer holds an id, not a key: reading one record to learn which
 * other record to read is cheaper to reason about than a duplicated key, and
 * deleting an account cannot leave a stale secret behind.
 *
 * Single-key installs from the first version are migrated on first read: the
 * old `dsh-connect-updream/default` record is adopted as one account and
 * removed, so existing users keep working without re-entering anything.
 *
 * @module dsh-connect-updream/accounts
 */

import { randomUUID } from 'node:crypto';

/** Credential scope; every record this plugin owns lives under it. */
export const CREDENTIAL_SCOPE = 'dsh-connect-updream';

/** The pointer record naming the active account id. */
const ACTIVE_ID = 'active';

/** The pre-multi-account record, adopted once and then removed. */
const LEGACY_ID = 'default';

/** The account id pattern the credential key grammar accepts: `[a-z][a-z0-9-]*`. */
const ACCOUNT_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Ids the scope owns itself and that are therefore NOT accounts.
 *
 * `default` is on this list because it is the first version's single-key
 * record: it matches the account-id grammar, so without this exclusion
 * `list()` would report the legacy key as an account and the migration would
 * then find "the same key already exists", skip adopting it, and delete it —
 * losing the user's only key.
 */
const RESERVED_IDS = new Set([ACTIVE_ID, LEGACY_ID, 'account']);

/**
 * Build the vault key for one account.
 * @param id - account id.
 * @returns the `<scope>/<id>` credential address.
 */
export function accountKey(id) {
  return `${CREDENTIAL_SCOPE}/${id}`;
}

/**
 * Whether a string may be used as an account id at all.
 * @param value - candidate.
 * @returns true when the vault grammar and this module both accept it.
 */
export function isAccountId(value) {
  return typeof value === 'string' && ACCOUNT_ID_PATTERN.test(value) && !RESERVED_IDS.has(value);
}

/**
 * A fresh account id. Prefixed so a human reading the vault file can tell an
 * account record from the pointer at a glance.
 * @returns the id.
 */
function newAccountId() {
  return `account-${randomUUID().toLowerCase()}`;
}

/**
 * Build a record's `env` metadata, omitting every empty value.
 *
 * The vault rejects an empty env value outright (`env "<name>" must be a
 * non-empty string`), so a cleared label has to be an ABSENT key rather than a
 * key holding `''` — writing the empty string would fail the whole record
 * write, not just the label.
 * @param meta - candidate metadata; empty values are dropped.
 * @returns the env object to store, or undefined when nothing is left.
 */
function envOf(meta) {
  const env = {};
  for (const [name, value] of Object.entries(meta)) {
    if (typeof value === 'string' && value.trim() !== '') env[name] = value.trim();
  }
  return Object.keys(env).length === 0 ? undefined : env;
}

/**
 * Read one account record as a plain account object.
 * @param record - the vault record, or undefined.
 * @param id - the id the record was stored under.
 * @returns the account, or undefined when the record is absent or unreadable.
 */
function accountOf(record, id) {
  if (record === undefined || record.kind !== 'api-key') return undefined;
  const key = typeof record.key === 'string' ? record.key : '';
  if (key === '') return undefined;
  const meta = record.env !== null && typeof record.env === 'object' ? record.env : {};
  return {
    id,
    key,
    label: typeof meta.label === 'string' ? meta.label : '',
    upstreamId: typeof meta.upstreamId === 'string' ? meta.upstreamId : '',
    username: typeof meta.username === 'string' ? meta.username : '',
    addedAt: typeof meta.addedAt === 'string' ? meta.addedAt : '',
  };
}

/**
 * The public view of one account: everything a settings page may show.
 * @param account - the account.
 * @returns display facts, with no secret.
 */
export function publicAccount(account) {
  return {
    id: account.id,
    label: account.label,
    username: account.username,
    upstreamId: account.upstreamId,
    addedAt: account.addedAt,
  };
}

/**
 * A masked preview of a key, safe for a list row.
 * @param key - the full key.
 * @returns `sk-abcd…wxyz` style text.
 */
export function maskKey(key) {
  if (typeof key !== 'string' || key.length < 12) return 'sk-…';
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}

/**
 * The multi-account store over one credential seam.
 */
export class AccountStore {
  /**
   * @param credentials - the credential provider from the Host context.
   * @param probe - verifies one key upstream and reports who it belongs to.
   */
  constructor(credentials, probe) {
    this.credentials = credentials;
    this.probe = probe;
    /** Set once migration has run, so it costs at most one scan per process. */
    this.migrated = false;
  }

  /** Every stored account, in insertion order. */
  async list() {
    await this.migrateOnce();
    const entries = await this.credentials.listRecords();
    const accounts = [];
    for (const entry of entries) {
      const address = String(entry.key);
      if (!address.startsWith(`${CREDENTIAL_SCOPE}/`)) continue;
      const id = address.slice(CREDENTIAL_SCOPE.length + 1);
      if (!isAccountId(id)) continue;
      if (entry.kind !== 'api-key') continue;
      const record = await this.credentials.readRecord(address);
      const account = accountOf(record, id);
      if (account !== undefined) accounts.push(account);
    }
    return accounts;
  }

  /**
   * The raw pointer value, without the single-account fallback.
   * @returns the stored id, or an empty string.
   */
  async readPointer() {
    const record = await this.credentials.readRecord(accountKey(ACTIVE_ID));
    const id = record !== undefined && record.kind === 'api-key' && typeof record.key === 'string' ? record.key : '';
    return isAccountId(id) ? id : '';
  }

  /**
   * Fill in identity fields a migrated account is missing, so a row that came
   * from the single-key layout shows a person rather than an id.
   * @param account - the account to inspect.
   * @returns the same account, enriched in place when the probe answers.
   */
  async describe(account) {
    if (account.username !== '' && account.upstreamId !== '') return account;
    try {
      const identity = await this.probe(account.key);
      const env = envOf({
        ...account.label === '' ? {} : { label: account.label },
        upstreamId: String(identity.id ?? ''),
        username: String(identity.username ?? ''),
        addedAt: account.addedAt,
      });
      await this.credentials.modifyRecord(accountKey(account.id), async (current) => {
        if (accountOf(current, account.id) === undefined) return undefined;
        return { kind: 'api-key', key: account.key, ...env === undefined ? {} : { env } };
      });
      return { ...account, upstreamId: String(identity.id ?? ''), username: String(identity.username ?? '') };
    } catch {
      return account;
    }
  }

  /**
   * Whether one account record exists and is readable.
   * @param id - candidate account id.
   * @returns true when the account can be used.
   */
  async has(id) {
    return accountOf(await this.credentials.readRecord(accountKey(id)), id) !== undefined;
  }

  /** The active account id, or an empty string when none is chosen. */
  async activeId() {
    const pointer = await this.readPointer();
    if (pointer !== '') return pointer;
    // No pointer: an install with exactly one account uses it. Every other
    // path writes the pointer explicitly, so this only covers a vault edited
    // by hand or a migration that has not run yet.
    const accounts = await this.list();
    return accounts.length === 1 ? accounts[0].id : '';
  }

  /**
   * The account requests should use right now.
   * @returns the active account, or undefined when none is configured.
   */
  async active() {
    const id = await this.activeId();
    if (id === '') return undefined;
    const record = await this.credentials.readRecord(accountKey(id));
    return accountOf(record, id);
  }

  /**
   * Verify a key upstream and store it as a new account.
   * @param key - the `sk-…` key.
   * @param label - user-facing name; empty means "show the upstream username".
   * @returns the stored account.
   */
  async add(key, label = '') {
    const identity = await this.probe(key);
    const existing = (await this.list()).find((account) => account.key === key);
    if (existing !== undefined) {
      const name = existing.label || existing.username;
      throw new Error(`这个 Key 已经加过了${name === '' ? '' : `（${name}）`}，不用重复添加`);
    }
    const id = newAccountId();
    const env = envOf({
      label: String(label ?? ''),
      upstreamId: String(identity.id ?? ''),
      username: String(identity.username ?? ''),
      addedAt: new Date().toISOString(),
    });
    await this.credentials.modifyRecord(accountKey(id), async () => ({
      kind: 'api-key',
      key,
      ...env === undefined ? {} : { env },
    }));
    // Write the pointer whenever it does not already name an existing account.
    // Relying on `activeId()`'s single-account fallback would leave no pointer
    // at all: adding a second account then makes that fallback stop applying,
    // and the plugin would silently lose its active account.
    const pointer = await this.readPointer();
    if (pointer === '' || !(await this.has(pointer))) {
      await this.credentials.modifyRecord(accountKey(ACTIVE_ID), async () => ({ kind: 'api-key', key: id }));
    }
    return accountOf(await this.credentials.readRecord(accountKey(id)), id);
  }

  /**
   * Switch the active account.
   * @param id - an existing account id.
   */
  async activate(id) {
    if (!isAccountId(id)) throw new Error(`没有这个账号：${id}`);
    const record = await this.credentials.readRecord(accountKey(id));
    if (accountOf(record, id) === undefined) throw new Error(`没有这个账号：${id}`);
    await this.credentials.modifyRecord(accountKey(ACTIVE_ID), async () => ({ kind: 'api-key', key: id }));
  }

  /**
   * Rename one account.
   * @param id - the account id.
   * @param label - the new label; an empty string clears it back to the username.
   */
  async rename(id, label) {
    if (!isAccountId(id)) throw new Error(`没有这个账号：${id}`);
    await this.credentials.modifyRecord(accountKey(id), async (current) => {
      const account = accountOf(current, id);
      if (account === undefined) throw new Error(`没有这个账号：${id}`);
      const previous = current.kind === 'api-key' && current.env !== null && typeof current.env === 'object' ? current.env : {};
      const next = envOf({ ...previous, label: String(label ?? '') });
      return { kind: 'api-key', key: account.key, ...next === undefined ? {} : { env: next } };
    });
  }

  /**
   * Remove one account. When it was active, the next remaining account takes
   * over rather than leaving the plugin pointed at a deleted key.
   * @param id - the account id.
   * @returns the id that became active, or an empty string when none is left.
   */
  async remove(id) {
    if (!isAccountId(id)) throw new Error(`没有这个账号：${id}`);
    const wasActive = (await this.activeId()) === id;
    await this.credentials.deleteRecord(accountKey(id));
    if (!wasActive) return (await this.activeId()) || '';
    const remaining = await this.list();
    const next = remaining.length === 0 ? '' : remaining[0].id;
    if (next === '') await this.credentials.deleteRecord(accountKey(ACTIVE_ID));
    else await this.credentials.modifyRecord(accountKey(ACTIVE_ID), async () => ({ kind: 'api-key', key: next }));
    return next;
  }

  /**
   * Adopt the single-key record written by the first plugin version. Runs at
   * most once per process; a failure leaves the legacy record untouched so the
   * next read can retry rather than losing the user's key.
   */
  async migrateOnce() {
    if (this.migrated) return;
    this.migrated = true;
    try {
      const legacy = await this.credentials.readRecord(accountKey(LEGACY_ID));
      const account = accountOf(legacy, LEGACY_ID);
      if (account === undefined) return;
      const existed = (await this.list()).some((existing) => existing.key === account.key);
      if (!existed) {
        // A fresh id, not the legacy one: the old record is addressed by
        // `dsh-connect-updream/default`, so adopting it under that same id would
        // write to the very address it is about to delete.
        const id = newAccountId();
        await this.credentials.modifyRecord(accountKey(id), async () => legacy);
        await this.credentials.modifyRecord(accountKey(ACTIVE_ID), async (current) => (
          current !== undefined ? undefined : { kind: 'api-key', key: id }
        ));
      }
      await this.credentials.deleteRecord(accountKey(LEGACY_ID));
    } catch {
      // Leave the legacy record in place; an unreachable vault is reported by
      // whichever route the page called, not swallowed into silence here.
      this.migrated = false;
    }
  }
}
