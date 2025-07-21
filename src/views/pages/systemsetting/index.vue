<template>
  <v-container fluid>
    <v-row>
      <!-- Left Column: Tree Navigation -->
      <v-col cols="3">
        <v-card>
          <v-card-title>{{ t('system_settings.title') }}</v-card-title>
          <v-card-text>
            <v-treeview :items="groupItems" color="warning" activatable open-all item-value="id" item-title="name"
              item-children="children" v-model:activated="activeGroups" />
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
              <v-list-item v-for="setting in settinglist" :key="setting.id"
              :class="{ 'highlighted-item': setting.id === selectItemid }"
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
                    <v-text-field density="compact" :value="setting.value" variant="outlined" single-line class="shrink"
                      style="width: 100%;" type="text"
                      :loading="loadingSettings[setting.id]"
                      @update:modelValue="updateSetting(setting.id, $event)"
                      >
                    </v-text-field>
                    <v-divider></v-divider>
                  </div>

                  <div v-else-if="setting.type === 'select'">
                    <v-select :items="setting.options || []" 
                    :value="setting.value" 
                    variant="outlined" 
                    density="compact"
                    :loading="loadingSettings[setting.id]"
                      @update:modelValue="updateSetting(setting.id, $event)"
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
                    <v-radio-group :model-value="setting.value"
                      @update:modelValue="updateSetting(setting.id, $event)"
                    >
                      <v-radio v-for="(opt, idx) in setting.options || []" :key="idx" :label="opt.optionLabel"  
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
                      @update:modelValue="updateSetting(setting.id, $event ? '1' : '0')"
                      color="primary"
                      hide-details
                    ></v-switch>
                    <v-divider></v-divider>
                  </div>


                  <!-- Default to text input if the type is unrecognized -->
                  <div v-else>
                    <v-text-field :value="setting.value" variant="outlined" density="compact"
                     :loading="loadingSettings[setting.id]"
                     @update:modelValue="updateSetting(setting.id, $event)"></v-text-field>
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
  </v-container>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { SystemSettingDisplay, SystemSettingGroupDisplay, OptionSettingDisplay } from "@/entityTypes/systemsettingType";
import { getSystemSettinglist,updateSystemSetting } from "@/views/api/systemsetting";
// i18n setup
const { t } = useI18n();
import { chooseFileDialog } from "@/views/api/common"

// Store references for settings, groups, and tree state
//const systemSettings = ref<SystemSettingDisplay[]>([]);
const settingGroups = ref<SystemSettingGroupDisplay[]>([]);
const settinglist = ref<SystemSettingDisplay[]>([])
const selectedGroup = ref<SystemSettingGroupDisplay | null>(null);
// For Vuetify's Treeview
const activeGroups = ref<number[]>([]);
const selectItemid=ref<number>(0)
const loadingSettings = ref<Record<number, boolean>>({});
//const openGroups = ref<number[]>([]);

// Convert each group into a tree item.
// If you need deeper nesting, gather children by parentId, etc.
const groupItems = computed(() => {
  return settingGroups.value.map(group => ({
    id: group.id,
    name: group.name,
    description: group.description,
    children: group.items.map(item => ({
      id: item.id,
      name: item.key,
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
    console.log('Selected group changed:', newVal[0]);

    //console.log("activeGroups value " + newVal)

    // if (!activeGroups.value.length || !activeGroups.value) return null;
    selectItemid.value = newVal[0]
    // Extract the selected item ID
    const itemId = activeGroups.value[0];
    // Initialize groupId with itemId in case it's already a group ID
    let groupId = itemId;

    // Check if this is an item (not a group)
    //let foundInGroup = false;
    for (const group of settingGroups.value) {
      // Check if itemId is a setting item ID in this group
      const matchingItem = group.items.find(item => item.id === itemId);
      if (matchingItem) {
        // If found, use the parent group's ID
        groupId = group.id;
        //foundInGroup = true;
        break;
      }
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
  console.log("groupId", groupId)
  if (settingGroups.value.length > 0) {
    settingGroups.value.forEach((group) => {
      console.log(group)
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
    console.log(res)
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
    
    // Call API to update the setting
    await updateSystemSetting(settingId, valueToSave);
    
    // Update local state
    const setting = settinglist.value.find(s => s.id === settingId);
    if (setting) {
      setting.value = valueToSave;
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

onMounted(() => {
  fetchSettings().then(() => {
    if (settingGroups.value.length > 0 && activeGroups.value.length === 0) {
      activeGroups.value = [settingGroups.value[0].id];
    }
    console.log("activegroup.value", activeGroups.value)
  })
});
</script>

<style scoped>
/* Adjust styling as desired */
.highlighted-item {
  background-color: rgba(255, 193, 7, 0.15); /* Using warning color with opacity */
  border-left: 3px solid #ffc107; /* Warning color border */
  font-weight: bold;
}
</style>