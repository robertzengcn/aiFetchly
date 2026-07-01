import { BaseModule } from "@/modules/baseModule";
import { SystemSettingModel } from "@/model/SystemSetting.model";
import { SystemSettingEntity } from "@/entity/SystemSetting.entity";
import { SystemSettingGroupEntity } from "@/entity/SystemSettingGroup.entity";

export class SystemSettingModule extends BaseModule {
  private systemSettingModel: SystemSettingModel;
  constructor() {
    super();
    this.systemSettingModel = new SystemSettingModel(this.dbpath);
  }
  public async updateSystemSetting(
    settingId: number,
    settingValue: string | null
  ): Promise<SystemSettingEntity> {
    return this.systemSettingModel.updateSystemSetting(settingId, settingValue);
  }

  /**
   * Look up a setting value by key. Returns null when the setting row is
   * absent. Callers decide their own default. Used for user-controllable
   * preferences stored in the system_setting table (e.g. auto-dream,
   * memory injection) as opposed to subscription flags kept on Token.
   */
  public async getSettingValue(key: string): Promise<string | null> {
    const setting = await this.systemSettingModel.getSettingItem(key);
    return setting?.value ?? null;
  }

  /**
   * Get or create default embedding model setting
   * @param group SystemSettingGroupEntity for embedding settings
   * @returns SystemSettingEntity for default embedding model
   */
  public async getOrCreateDefaultEmbeddingModel(
    group: SystemSettingGroupEntity
  ): Promise<SystemSettingEntity> {
    return this.systemSettingModel.getOrCreateDefaultEmbeddingModel(group);
  }

  /**
   * Update default embedding model setting
   * @param modelName The embedding model name (e.g., "text-embedding-ada-002")
   * @param dimension The vector dimension (e.g., 1536)
   * @param group SystemSettingGroupEntity for embedding settings
   * @returns Updated SystemSettingEntity
   * @throws Error if parameters are invalid
   */
  public async updateDefaultEmbeddingModel(
    modelName: string,
    dimension: number,
    group: SystemSettingGroupEntity
  ): Promise<SystemSettingEntity> {
    // Validate modelName
    if (!modelName || typeof modelName !== "string" || !modelName.trim()) {
      throw new Error("Model name is required and must be a non-empty string");
    }

    // Validate dimension
    if (
      !dimension ||
      typeof dimension !== "number" ||
      dimension <= 0 ||
      !Number.isInteger(dimension)
    ) {
      throw new Error("Dimension is required and must be a positive integer");
    }

    // Combine modelName and dimension into the required format
    const combinedModelName = `${modelName.trim()}:${dimension}`;

    return this.systemSettingModel.updateDefaultEmbeddingModel(
      combinedModelName,
      group
    );
  }

  /**
   * Get default embedding model value
   * @returns Default embedding model info with name and dimension, or null if not found
   */
  public async getDefaultEmbeddingModel(): Promise<{
    modelName: string;
    dimension: number;
  } | null> {
    const modelValue = await this.systemSettingModel.getDefaultEmbeddingModel();

    if (!modelValue) {
      return null;
    }

    // Split the stored value (format: "modelName:dimension")
    const parts = modelValue.split(":");
    if (parts.length !== 2) {
      console.warn(`Invalid default embedding model format: ${modelValue}`);
      return null;
    }

    const [modelName, dimensionStr] = parts;
    const dimension = parseInt(dimensionStr, 10);

    if (isNaN(dimension) || dimension <= 0) {
      console.warn(
        `Invalid dimension value in default embedding model: ${dimensionStr}`
      );
      return null;
    }

    return {
      modelName: modelName.trim(),
      dimension: dimension,
    };
  }
}
