/**
 * SkillCredentialModule — the SQLite-side owner of credential bindings
 * (TODO 9, design §14.1/§20.3). Wraps SkillCredentialService so every
 * store/delete ALSO records the opaque binding row: the two-part
 * persistence the design specifies (bindings queryable in SQLite, values
 * only in the safeStorage-backed store) instead of the store-only
 * deviation shipped initially.
 *
 * The secret VALUE crosses this module exactly once — straight from the
 * secure IPC into the service — and never touches SQLite, logs, or
 * diagnostics.
 */

import { BaseModule } from "@/modules/baseModule";
import {
  SkillCredentialBindingModel,
} from "@/model/SkillCredentialBinding.model";
import { SkillCredentialService } from "@/service/SkillCredentialService";

export interface CredentialBindingView {
  readonly installationId: string;
  readonly environmentVariable: string;
  readonly status: string;
  readonly storedAt: string;
}

export class SkillCredentialModule extends BaseModule {
  private model: SkillCredentialBindingModel | null = null;
  private readonly service = new SkillCredentialService();

  private async getModel(): Promise<SkillCredentialBindingModel> {
    await this.ensureConnection();
    if (!this.model) {
      this.model = new SkillCredentialBindingModel(this.dbpath);
    }
    return this.model;
  }

  /**
   * Store a credential value (fail-closed safeStorage) AND record the
   * opaque binding. If the encrypted write refuses, NO binding row is
   * written — the two stores can never disagree about what exists.
   */
  async store(
    installationId: string,
    environmentVariable: string,
    value: string
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    let stored: { ok: true } | { ok: false; message: string };
    try {
      stored = this.service.store(
        installationId,
        environmentVariable,
        value
      );
    } catch (err) {
      // A THROWING value-store is still a fail-closed refusal — surface it
      // as the structured denial so no binding row is ever written.
      stored = {
        ok: false,
        message:
          `Credential store refused the write: ${
            err instanceof Error ? err.message : String(err)
          }`,
      };
    }
    if (!stored.ok) return { ok: false, message: stored.message };

    const model = await this.getModel();
    await model.upsert({
      installationId,
      environmentVariable,
      bindingRef: `${installationId}:${environmentVariable}`,
      status: "configured",
      storedAt: new Date(),
    });
    return { ok: true };
  }

  /** Retrieve for injection into ONE approved child process (§13). */
  retrieve(
    installationId: string,
    environmentVariable: string
  ): string | null {
    return this.service.retrieve(installationId, environmentVariable);
  }

  /** Binding views for the skill-detail UI — names + status, never values. */
  async listBindings(
    installationId: string
  ): Promise<readonly CredentialBindingView[]> {
    const model = await this.getModel();
    const rows = await model.listByInstallation(installationId);
    return rows.map((row) => ({
      installationId: row.installationId,
      environmentVariable: row.environmentVariable,
      status: row.status,
      storedAt: row.storedAt.toISOString(),
    }));
  }

  /**
   * Delete credentials for an installation: values from the encrypted
   * store, bindings from SQLite (rows removed — audit history lives in the
   * installation event log, not here).
   */
  async deleteAll(installationId: string): Promise<number> {
    const valuesDeleted = this.service.delete(installationId);
    const model = await this.getModel();
    const bindingsDeleted = await model.deleteByInstallation(installationId);
    // The store deletes by key prefix; both counts should agree.
    void valuesDeleted;
    return bindingsDeleted;
  }

  /** Configured status without ever revealing the value (§19.2). */
  isConfigured(
    installationId: string,
    environmentVariable: string
  ): boolean {
    return (
      this.service.retrieve(installationId, environmentVariable) !== null
    );
  }
}
