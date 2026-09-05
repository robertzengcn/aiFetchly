<template>
  <AppPageShell page-id="settings-general" title-key="route.system_setting" content-width="form">
    <!-- Category navigation stays in-page (IPR-032): tree + detail columns. -->
    <v-row>
      <!-- Left Column: Tree Navigation -->
      <v-col cols="3">
        <v-card>
          <v-card-text>
            <v-treeview
              :items="groupItems" color="warning" activatable open-all item-value="id" item-title="name"
              item-children="children" select-strategy="single-leaf" v-model:activated="activeGroups" />
            <v-divider class="my-4"></v-divider>
            <v-btn
              color="primary"
              variant="outlined"
              block
              @click="navigateToMCP"
              class="mb-2"
            >
              <v-icon left>mdi-toolbox</v-icon>
              {{ t('system_settings.manage_mcp_tools') }}
            </v-btn>
            <v-btn
              color="primary"
              variant="outlined"
              block
              @click="navigateToSkills"
              class="mb-2"
            >
              <v-icon left>mdi-view-dashboard</v-icon>
              {{ t('system_settings.manage_skills') }}
            </v-btn>
            <v-btn
              color="primary"
              variant="outlined"
              block
              @click="navigateToAIMemory"
              class="mb-2"
            >
              <v-icon left>mdi-brain</v-icon>
              {{ t('system_settings.manage_ai_memories') }}
            </v-btn>
            <v-btn
              color="primary"
              variant="outlined"
              block
              @click="navigateToAIProvider"
              class="mb-2"
            >
              <v-icon left>mdi-robot-outline</v-icon>
              {{ t('system_settings.manage_ai_provider') || 'AI Provider' }}
            </v-btn>
            <v-btn
              color="primary"
              variant="outlined"
              block
              @click="navigateToHooks"
              class="mb-2"
            >
              <v-icon left>mdi-hook</v-icon>
              {{ t('system_settings.manage_hooks') || 'Manage Hooks' }}
            </v-btn>
            <v-btn
              color="primary"
              variant="outlined"
              block
              @click="navigateToSubagents"
              class="mb-2"
            >
              <v-icon left>mdi-robot-outline</v-icon>
              {{ t('system_settings.manage_subagents') || 'Manage Subagents' }}
            </v-btn>
            <v-btn
              color="primary"
              variant="outlined"
              block
              @click="navigateToAbout"
              class="mb-2"
            >
              <v-icon left>mdi-information-outline</v-icon>
              {{ t('about.title') || 'About aiFetchly' }}
            </v-btn>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Right Column: Settings Detail -->
      <v-col cols="9">
        <v-card>
          <v-card-title v-if="selectedGroup">
            {{ t('system_settings.' + selectedGroup.name) }}
          </v-card-title>
          <v-card-text v-if="selectedGroup">
              <p>{{ t('system_settings.' + selectedGroup.description) }}</p>
            <v-list>
              <v-list-item
v-for="setting in settinglist" :key="setting.id"
              :class="{ 'highlighted-item': setting.id === selectedSettingId }"
              >
                <v-list-item-content>
                  <v-list-item-title>
                    {{ t('system_settings.' + setting.key) }}
                  </v-list-item-title>
                  <v-list-item-subtitle>
                    {{ t('system_settings.' +setting.description) || t('system_settings.no_description') }}
                  </v-list-item-subtitle>
                </v-list-item-content>
                <v-list-item>
                  <!-- Determine the input component based on setting.type -->
                  <div v-if="setting.type === 'input'" class="mt-3">
                    <v-text-field
density="compact" :value="setting.value" variant="outlined" single-line class="shrink"
                      style="width: 100%;" type="text"
                      :loading="loadingSettings[setting.id]"
                      @update:model-value="updateSetting(setting.id, $event)"
                      >
                    </v-text-field>
                    <v-divider></v-divider>
                  </div>

                  <div v-else-if="setting.type === 'select'">
                    <v-select
:items="setting.options || []" 
                    :value="setting.value" 
                    variant="outlined" 
                    density="compact"
                    :loading="loadingSettings[setting.id]"
                      @update:model-value="updateSetting(setting.id, $event)"
                      >
                    </v-select>
                    <v-divider></v-divider>
                  </div>
                  <div v-else-if="setting.type === 'file'">
                    <span v-if="setting.value" class="ml-2 mb-2 mt-2">{{ setting.value }}</span>
                    <v-btn
                      color="primary"
                      variant="outlined"
                      class="mb-2 mt-2"
                      :loading="loadingSettings[setting.id]"
                      @click="openFileDialog(setting.id)"
                    >
                    {{ t('system_settings.choose_file') }}
                    </v-btn>
                    
                    <v-divider></v-divider>
                  </div>

                  <div v-else-if="setting.type === 'radio'">
                    <v-radio-group
:model-value="setting.value"
                      @update:model-value="updateSetting(setting.id, $event)"
                    >
                      <v-radio
v-for="(opt, idx) in setting.options || []" :key="idx" :label="opt.optionLabel"  
                      :value="opt.optionValue" />
                    </v-radio-group>
                    <v-divider></v-divider>
                  </div>

                  <div v-else-if="setting.type === 'checkbox'">
                    <v-checkbox :value="setting.value === 'true'" :label="setting.label || setting.key" 
                     
                    />
                    <v-divider></v-divider>
                  </div>
                  <div v-else-if="setting.type === 'toggle'">
                    <v-switch
                      :model-value="setting.value === '1'"
                      :loading="loadingSettings[setting.id]"
                      @update:model-value="updateSetting(setting.id, $event ? '1' : '0')"
                      color="primary"
                      hide-details
                    ></v-switch>
                    <v-divider></v-divider>
                  </div>

                  <div v-else-if="setting.type === 'textarea'">
                    <!-- NOTE: textarea saves on @blur, not on every keystroke.
                         The 'input' type uses @update:model-value which would
                         fire IPC on every char for a textarea — too noisy. -->
                    <v-textarea
                      :model-value="setting.value"
                      :placeholder="t('system_settings.ai-custom-context-directive-placeholder') || 'Static instructions prepended to every AI chat request (like CLAUDE.md)...'"
                      variant="outlined"
                      density="comfortable"
                      rows="6"
                      auto-grow
                      counter
                      maxlength="8000"
                      hide-details="auto"
                      :loading="loadingSettings[setting.id]"
                      @blur="updateSetting(setting.id, $event.target.value)"
                    ></v-textarea>
                    <v-divider></v-divider>
                  </div>

                  <!-- Default to text input if the type is unrecognized -->
                  <div v-else>
                    <v-text-field
:value="setting.value" variant="outlined" density="compact"
                     :loading="loadingSettings[setting.id]"
                     @update:model-value="updateSetting(setting.id, $event)"></v-text-field>
                      <v-divider></v-divider>
                  </div>
                </v-list-item>
              </v-list-item>
            </v-list>
          </v-card-text>

          <v-card-text v-else>
            <v-alert type="info">
              {{ t('system_settings.no_setting_item_found_exit') }}
            </v-alert>
          </v-card-text>
        </v-card>

      </v-col>
    </v-row>

    <!-- Diagnostics section (always visible, independent of selected group) -->
    <DiagnosticsSection />
  </AppPageShell>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { SystemSettingDisplay, SystemSettingGroupDisplay } from "@/entityTypes/systemsettingType";
import { getSystemSettinglist, updateSystemSetting, updateSystemSettingWithValidation } from "@/views/api/systemsetting";
import { updateLanguagePreference } from '@/views/api/language';
import { language_preference } from '@/config/settinggroupInit';
import { setLanguage } from '@/views/utils/cookies';
// i18n setup
const { t, locale } = useI18n();
const router = useRouter();
import { chooseFileDialog } from "@/views/api/common"
import DiagnosticsSection from "@/views/components/settings/DiagnosticsSection.vue"
import AppPageShell from "@/views/components/pageTemplates/AppPageShell.vue"

type TreeNodeId = `group:${number}` | `setting:${number}`;

interface SettingTreeItem {
  id: TreeNodeId;
  name: string;
  description?: string;
  children?: SettingTreeItem[];
}

function groupNodeId(id: number): TreeNodeId {
  return `group:${id}`;
}

function settingNodeId(id: number): TreeNodeId {
  return `setting:${id}`;
}

function parseTreeNodeId(nodeId: TreeNodeId): { type: "group" | "setting"; id: number } {
  const [type, rawId] = nodeId.split(":");
  const id = Number(rawId);

  if ((type !== "group" && type !== "setting") || !Number.isInteger(id)) {
    throw new Error(`Invalid system setting tree node id: ${nodeId}`);
  }

  return { type, id };
}

// Store references for settings, groups, and tree state
//const systemSettings = ref<SystemSettingDisplay[]>([]);
const settingGroups = ref<SystemSettingGroupDisplay[]>([]);
const settinglist = ref<SystemSettingDisplay[]>([])
const selectedGroup = ref<SystemSettingGroupDisplay | null>(null);
// For Vuetify's Treeview
const activeGroups = ref<TreeNodeId[]>([]);
const selectedSettingId = ref<number | null>(null);
const loadingSettings = ref<Record<number, boolean>>({});
//const openGroups = ref<number[]>([]);

// Convert each group into a tree item with translated labels.
const groupItems = computed<SettingTreeItem[]>(() => {
  return settingGroups.value.map(group => ({
    id: groupNodeId(group.id),
    name: t('system_settings.' + group.name) || group.name,
    description: group.description,
    children: group.items.map(item => ({
      id: settingNodeId(item.id),
      name: t('system_settings.' + item.key) || item.key,
      description: item.description,
    })),
  }));
});

// Derived property for the "currently selected" group
//const selectedGroup = computed(() => {

// return settingGroups.value.find(g => g.id === groupId) || null;
// });

// Watch for changes in activeGroups
watch(activeGroups, (newVal) => {
  if (newVal && newVal.length > 0) {
    //console.log("activeGroups value " + newVal)

    // if (!activeGroups.value.length || !activeGroups.value) return null;
    // Extract the selected item ID
    const treeNode = parseTreeNodeId(activeGroups.value[0]);
    selectedSettingId.value = treeNode.type === "setting" ? treeNode.id : null;
    let groupId = treeNode.type === "group" ? treeNode.id : null;

    // Check if this is an item (not a group)
    //let foundInGroup = false;
    if (treeNode.type === "setting") {
      for (const group of settingGroups.value) {
        // Check if itemId is a setting item ID in this group
        const matchingItem = group.items.find(item => item.id === treeNode.id);
        if (matchingItem) {
          // If found, use the parent group's ID
          groupId = group.id;
          //foundInGroup = true;
          break;
        }
      }
    }

    if (groupId === null) {
      return;
    }

    settinglist.value = settingsByGroup(groupId)
    
    selectedGroup.value=settingGroups.value.find(g => g.id === groupId) || null;
    //settingGroups.value.find(g => g.id === groupId) || null;

    // settinglist.value = settingsByGroup(newVal[0]);

  }
}, { deep: true });

// Return settings belonging to the given group
function settingsByGroup(groupId: number): SystemSettingDisplay[] {
  let result: SystemSettingDisplay[] = []
  if (settingGroups.value.length > 0) {
    settingGroups.value.forEach((group) => {
      if (group.id === groupId) {
        result = group.items
      }
    })
  }
  return result
  // return systemSettings.value.filter(setting => setting.group_id === groupId);
}
// function handleActiveChange(newActiveGroups: number[]) {
//   console.log('Active groups changed:', newActiveGroups);
//   // Custom handling logic here
//   if (newActiveGroups.length > 0) {
//     settinglist.value = settingsByGroup(newActiveGroups[0]);
//   }
// }
// function handleActiveChange(newActive: number[]) {
//   // If trying to click the already active item (deactivating it)
//   if (newActive.length === 0 && activeGroups.value.length > 0) {
//     // Prevent deactivation by keeping the current selection
//     return;
//   }

//   // If clicking a different item, allow the change
//   if (!activeGroups.value.includes(newActive[0])) {
//     activeGroups.value = newActive;
//     // Additional logic when selection changes
//     if (newActive.length > 0) {
//       settinglist.value = settingsByGroup(newActive[0]);
//     }
//   }
// }
// Mock fetching settings and groups
async function fetchSettings() {
  await getSystemSettinglist().then((res) => {
    settingGroups.value = res
  })
  // // Replace with real API / DB calls
  // settingGroups.value = [

  // ];
  // // Each setting now includes a "type" field and possible "options"
  // systemSettings.value = [];
}

// Updates a single setting
async function updateSetting(settingId: number, newValue: string | boolean|null) {
  // Convert boolean to string if needed
  const valueToSave = typeof newValue === 'boolean' ? newValue.toString() : newValue;
  
  console.log(`Saving setting #${settingId} to:`, valueToSave);
  
  try {
    // Show loading indicator
    loadingSettings.value[settingId] = true;
    
    // Get the setting to determine if we need validation
    const setting = settinglist.value.find(s => s.id === settingId);
    
    // Use validation for language preferences
    if (setting?.key === language_preference) {
      await updateSystemSettingWithValidation(settingId, valueToSave, setting.key);
    } else {
      await updateSystemSetting(settingId, valueToSave);
    }
    
    // Update local state
    if (setting) {
      setting.value = valueToSave;
      
      // Handle language preference changes with real-time switching
      if (setting.key === language_preference && typeof valueToSave === 'string') {
        console.log('Language preference changed, applying real-time switch:', valueToSave);
        await handleLanguageChange(valueToSave);
      }
    }
    
    // Optional: Show success message
    // e.g., toast.success("Setting saved")
  } catch (error) {
    console.error('Failed to update setting:', error);
    // Optional: Show error message
    // e.g., toast.error("Failed to save")
  } finally {
    loadingSettings.value[settingId] = false;
  }
}

// Handle language preference changes
async function handleLanguageChange(newLanguage: string) {
  try {
    // Update the i18n locale immediately for real-time switching
    locale.value = newLanguage;
    setLanguage(newLanguage);
    
    // Also update the language preference via the API for consistency
    const success = await updateLanguagePreference(newLanguage);
    
    if (success) {
      console.log('Language switched successfully to:', newLanguage);
    } else {
      console.warn('Language preference update failed, but UI has been updated');
    }
  } catch (error) {
    console.error('Error handling language change:', error);
  }
}

// Add file dialog handler
async function openFileDialog(settingId: number) {
  // 
  try{
  const res=await chooseFileDialog()
  
  //if(res.status){
    await updateSetting(settingId, res)
  //}
  }catch(error){
    console.error('Failed to open file dialog:', error);
  }
}

function navigateToMCP() {
  router.push({ name: 'system_setting_mcp' });
}

function navigateToSkills() {
  router.push({ name: 'system_setting_skills' });
}

function navigateToAIMemory() {
  router.push({ name: 'system_setting_ai_memory' });
}

function navigateToAIProvider() {
  router.push({ name: 'system_setting_ai_provider' });
}

function navigateToHooks() {
  router.push({ name: 'system_setting_hooks' });
}

function navigateToSubagents() {
  router.push({ name: 'system_setting_subagents' });
}

function navigateToAbout() {
  router.push({ name: 'system_setting_about' });
}

onMounted(() => {
  fetchSettings().then(() => {
    if (settingGroups.value.length > 0 && activeGroups.value.length === 0) {
      activeGroups.value = [groupNodeId(settingGroups.value[0].id)];
    }
  })
});
</script>

<style scoped>
/* Adjust styling as desired */
.highlighted-item {
  background-color: var(--app-warning-soft);
  border-left: 3px solid var(--app-warning);
  font-weight: bold;
}
</style>
