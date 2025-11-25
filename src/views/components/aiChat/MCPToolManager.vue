<template>
  <v-dialog v-model="showDialog" max-width="900" scrollable persistent>
    <v-card>
      <v-card-title class="d-flex align-center justify-space-between">
        <span>Manage MCP Tools</span>
        <v-btn
          icon
          size="small"
          variant="text"
          @click="closeDialog"
        >
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>
      <v-divider></v-divider>
      
      <v-card-text style="padding: 0;">
        <!-- Loading State -->
        <div v-if="isLoading" class="pa-4 text-center">
          <v-progress-circular indeterminate color="primary"></v-progress-circular>
          <p class="mt-2">Loading MCP servers...</p>
        </div>

        <!-- Empty State -->
        <div v-else-if="servers.length === 0" class="pa-4 text-center">
          <v-icon size="48" color="grey-lighten-2">mdi-server-network</v-icon>
          <p class="mt-4 text-grey">No MCP servers configured</p>
          <v-btn
            color="primary"
            class="mt-4"
            @click="openAddDialog"
          >
            <v-icon left>mdi-plus</v-icon>
            Add MCP Server
          </v-btn>
        </div>

        <!-- Server List -->
        <v-list v-else density="comfortable">
          <v-list-item
            v-for="server in servers"
            :key="server.id"
            class="server-item"
            @click="toggleExpandServer(server.id)"
          >
            <template v-slot:prepend>
              <v-icon :color="server.enabled ? 'success' : 'grey'">
                {{ server.enabled ? 'mdi-server' : 'mdi-server-off' }}
              </v-icon>
            </template>

            <v-list-item-title class="d-flex align-center">
              <v-icon 
                size="small" 
                class="mr-2"
                :class="{ 'rotate-90': expandedServers.has(server.id) }"
                style="transition: transform 0.2s;"
              >
                mdi-chevron-right
              </v-icon>
              <span>{{ server.serverName }}</span>
              <v-chip
                size="x-small"
                :color="server.enabled ? 'success' : 'grey'"
                class="ml-2"
              >
                {{ server.enabled ? 'Enabled' : 'Disabled' }}
              </v-chip>
            </v-list-item-title>

            <v-list-item-subtitle>
              <div class="d-flex align-center mt-1">
                <v-icon size="x-small" class="mr-1">mdi-network</v-icon>
                <span>{{ server.transport }}://{{ server.host }}{{ server.port ? ':' + server.port : '' }}</span>
                <v-spacer></v-spacer>
                <span v-if="server.tools" class="text-caption">
                  {{ server.tools.length }} {{ server.tools.length === 1 ? 'tool' : 'tools' }}
                </span>
              </div>
            </v-list-item-subtitle>

            <template v-slot:append>
              <div class="d-flex align-center" @click.stop>
                <v-btn
                  icon
                  size="small"
                  variant="text"
                  @click.stop="toggleServer(server.id, !server.enabled)"
                  :title="server.enabled ? 'Disable server' : 'Enable server'"
                >
                  <v-icon size="small">
                    {{ server.enabled ? 'mdi-toggle-switch' : 'mdi-toggle-switch-off' }}
                  </v-icon>
                </v-btn>
                <v-btn
                  icon
                  size="small"
                  variant="text"
                  @click.stop="testConnection(server.id)"
                  :loading="testingServerId === server.id"
                  title="Test connection"
                >
                  <v-icon size="small">mdi-network-check</v-icon>
                </v-btn>
                <v-btn
                  icon
                  size="small"
                  variant="text"
                  @click.stop="discoverTools(server.id)"
                  :loading="discoveringServerId === server.id"
                  title="Discover tools"
                >
                  <v-icon size="small">mdi-magnify</v-icon>
                </v-btn>
                <v-btn
                  icon
                  size="small"
                  variant="text"
                  @click.stop="openEditDialog(server)"
                  title="Edit server"
                >
                  <v-icon size="small">mdi-pencil</v-icon>
                </v-btn>
                <v-btn
                  icon
                  size="small"
                  variant="text"
                  color="error"
                  @click.stop="confirmDelete(server)"
                  title="Delete server"
                >
                  <v-icon size="small">mdi-delete</v-icon>
                </v-btn>
              </div>
            </template>

            <!-- Expandable Tool List -->
            <v-expand-transition>
              <div v-if="expandedServers.has(server.id)" class="pa-4">
                <v-divider class="mb-4"></v-divider>
                <div v-if="!server.tools || server.tools.length === 0" class="text-caption text-grey">
                  No tools discovered. Click "Discover tools" to find available tools.
                </div>
                <v-list v-else density="compact" class="tool-list">
                  <v-list-item
                    v-for="toolName in server.tools"
                    :key="toolName"
                    class="tool-item"
                    @click.stop
                  >
                    <template v-slot:prepend>
                      <v-icon size="small" color="purple">mdi-toolbox</v-icon>
                    </template>
                    <v-list-item-title>{{ toolName }}</v-list-item-title>
                    <template v-slot:append>
                      <v-switch
                        :model-value="isToolEnabled(server, toolName)"
                        @update:model-value="toggleTool(server.id, toolName, $event as boolean)"
                        @click.stop
                        density="compact"
                        hide-details
                        color="primary"
                      ></v-switch>
                    </template>
                  </v-list-item>
                </v-list>
              </div>
            </v-expand-transition>
          </v-list-item>
        </v-list>
      </v-card-text>

      <v-divider></v-divider>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn
          variant="text"
          color="primary"
          @click="openAddDialog"
        >
          <v-icon left>mdi-plus</v-icon>
          Add Server
        </v-btn>
        <v-btn
          variant="text"
          @click="closeDialog"
        >
          Close
        </v-btn>
      </v-card-actions>
    </v-card>

    <!-- Add/Edit Server Dialog -->
    <v-dialog v-model="showServerDialog" max-width="600" persistent>
      <v-card>
        <v-card-title>
          {{ editingServer ? 'Edit MCP Server' : 'Add MCP Server' }}
        </v-card-title>
        <v-divider></v-divider>
        <v-card-text class="pt-4">
          <!-- Input Mode Toggle -->
          <div class="d-flex align-center mb-4">
            <v-btn-toggle
              v-model="inputMode"
              mandatory
              variant="outlined"
              density="compact"
              :disabled="!!editingServer"
            >
              <v-btn value="form">
                <v-icon left size="small">mdi-form-select</v-icon>
                Form
              </v-btn>
              <v-btn value="json" :disabled="!!editingServer">
                <v-icon left size="small">mdi-code-json</v-icon>
                JSON
              </v-btn>
            </v-btn-toggle>
            <v-spacer></v-spacer>
            <v-btn
              v-if="inputMode === 'json' && !editingServer"
              size="small"
              variant="text"
              @click="loadExampleJson"
            >
              <v-icon left size="small">mdi-file-document-outline</v-icon>
              Load Example
            </v-btn>
          </div>
          <v-alert
            v-if="editingServer"
            type="info"
            variant="tonal"
            density="compact"
            class="mb-4"
          >
            JSON mode is only available when adding new servers. Use Form mode to edit existing servers.
          </v-alert>

          <!-- Form Mode -->
          <div v-if="inputMode === 'form'">
            <v-text-field
              v-model="serverForm.serverName"
              label="Server Name"
              required
              variant="outlined"
              density="compact"
              :error-messages="serverFormErrors.serverName"
            ></v-text-field>

          <v-select
            v-model="serverForm.transport"
            label="Transport Type"
            :items="transportTypes"
            variant="outlined"
            density="compact"
            required
            @update:model-value="onTransportChange"
          ></v-select>

          <v-text-field
            v-model="serverForm.host"
            :label="serverForm.transport === 'stdio' ? 'Command' : 'Host'"
            :hint="serverForm.transport === 'stdio' ? 'Command to execute (e.g., node server.js)' : 'Hostname or IP address'"
            required
            variant="outlined"
            density="compact"
            :error-messages="serverFormErrors.host"
          ></v-text-field>

          <v-text-field
            v-if="serverForm.transport !== 'stdio'"
            v-model.number="serverForm.port"
            label="Port"
            type="number"
            variant="outlined"
            density="compact"
            :error-messages="serverFormErrors.port"
          ></v-text-field>

          <v-select
            v-model="serverForm.authType"
            label="Authentication Type"
            :items="authTypes"
            variant="outlined"
            density="compact"
            @update:model-value="onAuthTypeChange"
          ></v-select>

          <v-text-field
            v-if="serverForm.authType === 'api_key'"
            v-model="authConfig.apiKey"
            label="API Key"
            type="password"
            variant="outlined"
            density="compact"
          ></v-text-field>

          <v-text-field
            v-if="serverForm.authType === 'bearer_token'"
            v-model="authConfig.bearerToken"
            label="Bearer Token"
            type="password"
            variant="outlined"
            density="compact"
          ></v-text-field>

          <v-textarea
            v-if="serverForm.authType === 'custom'"
            v-model="authConfig.custom"
            label="Custom Auth Config (JSON)"
            variant="outlined"
            density="compact"
            rows="3"
            hint="Enter JSON configuration"
          ></v-textarea>

          <v-text-field
            v-model.number="serverForm.timeout"
            label="Timeout (ms)"
            type="number"
            variant="outlined"
            density="compact"
            hint="Request timeout in milliseconds"
          ></v-text-field>

          <v-switch
            v-model="serverForm.enabled"
            label="Enabled"
            color="primary"
            hide-details
            class="mt-2"
          ></v-switch>
          </div>

          <!-- JSON Mode -->
          <div v-else>
            <v-textarea
              v-model="jsonInput"
              label="MCP Server Configuration (JSON)"
              variant="outlined"
              density="compact"
              rows="12"
              hint="Enter MCP server configuration in JSON format"
              :error-messages="serverFormErrors.jsonInput"
              placeholder='{
  "mcpServers": {
    "server-name": {
      "command": "uvx",
      "args": ["blender-mcp"]
    }
  }
}'
            ></v-textarea>
            <v-alert
              v-if="inputMode === 'json'"
              type="info"
              variant="tonal"
              density="compact"
              class="mt-2"
            >
              <div class="text-caption">
                <strong>JSON Format:</strong> Use the <code>mcpServers</code> object where each key is the server name.
                For stdio transport, use <code>command</code> and <code>args</code>.
                For SSE/WebSocket, use <code>url</code> or <code>host</code> and <code>port</code>.
              </div>
            </v-alert>
          </div>
        </v-card-text>
        <v-divider></v-divider>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn
            variant="text"
            @click="cancelServerDialog"
          >
            Cancel
          </v-btn>
          <v-btn
            color="primary"
            :loading="savingServer"
            @click="saveServer"
          >
            {{ editingServer ? 'Update' : 'Add' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Delete Confirmation Dialog -->
    <v-dialog v-model="showDeleteDialog" max-width="400" persistent>
      <v-card>
        <v-card-title>Confirm Delete</v-card-title>
        <v-card-text>
          Are you sure you want to delete the server "{{ serverToDelete?.serverName }}"? This action cannot be undone.
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn
            variant="text"
            @click="showDeleteDialog = false"
          >
            Cancel
          </v-btn>
          <v-btn
            color="error"
            :loading="deletingServer"
            @click="deleteServer"
          >
            Delete
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  getMCPTools,
  addMCPServer,
  updateMCPServer,
  deleteMCPServer,
  discoverMCPTools,
  toggleServerEnabled,
  toggleToolEnabled,
  testMCPConnection,
  type MCPServer,
  type MCPServerConfig
} from '@/views/api/mcpTools';

const { t } = useI18n();

// Props
interface Props {
  modelValue: boolean;
}

const props = defineProps<Props>();

// Emits
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

// State
const showDialog = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
});

const servers = ref<MCPServer[]>([]);
const isLoading = ref(false);
const expandedServers = ref<Set<number>>(new Set());
const testingServerId = ref<number | null>(null);
const discoveringServerId = ref<number | null>(null);

// Server Dialog State
const showServerDialog = ref(false);
const editingServer = ref<MCPServer | null>(null);
const savingServer = ref(false);
const serverForm = ref<Partial<MCPServerConfig>>({
  serverName: '',
  host: '',
  port: undefined,
  transport: 'stdio',
  enabled: true,
  authType: 'none',
  timeout: 30000
});
const authConfig = ref<{
  apiKey?: string;
  bearerToken?: string;
  custom?: string;
}>({});
const serverFormErrors = ref<Record<string, string>>({});

// Input Mode
const inputMode = ref<'form' | 'json'>('form');
const jsonInput = ref('');

// Delete Dialog State
const showDeleteDialog = ref(false);
const serverToDelete = ref<MCPServer | null>(null);
const deletingServer = ref(false);

// Options
const transportTypes = [
  { title: 'Stdio', value: 'stdio' },
  { title: 'SSE', value: 'sse' },
  { title: 'WebSocket', value: 'websocket' }
];

const authTypes = [
  { title: 'None', value: 'none' },
  { title: 'API Key', value: 'api_key' },
  { title: 'Bearer Token', value: 'bearer_token' },
  { title: 'Custom', value: 'custom' }
];

// Watch for dialog open to load servers
watch(showDialog, (isOpen) => {
  if (isOpen) {
    loadServers();
  }
});

// Methods
async function loadServers() {
  isLoading.value = true;
  try {
    const response = await getMCPTools();
    if (response) {
      servers.value = response;
    }
  } catch (error) {
    console.error('Error loading MCP servers:', error);
  } finally {
    isLoading.value = false;
  }
}

function closeDialog() {
  showDialog.value = false;
}

function openAddDialog() {
  editingServer.value = null;
  inputMode.value = 'form';
  jsonInput.value = '';
  serverForm.value = {
    serverName: '',
    host: '',
    port: undefined,
    transport: 'stdio',
    enabled: true,
    authType: 'none',
    timeout: 30000
  };
  authConfig.value = {};
  serverFormErrors.value = {};
  showServerDialog.value = true;
}

function openEditDialog(server: MCPServer) {
  editingServer.value = server;
  inputMode.value = 'form';
  jsonInput.value = '';
  serverForm.value = {
    serverName: server.serverName,
    host: server.host,
    port: server.port,
    transport: server.transport as "stdio" | "sse" | "websocket",
    enabled: server.enabled,
    authType: server.authType as "none" | "api_key" | "bearer_token" | "custom",
    timeout: server.timeout
  };

  // Parse auth config if exists
  if (server.metadata) {
    try {
      const metadata = server.metadata as Record<string, unknown>;
      if (metadata.authConfig) {
        const auth = metadata.authConfig as Record<string, unknown>;
        if (server.authType === 'api_key') {
          authConfig.value = { apiKey: auth.apiKey as string };
        } else if (server.authType === 'bearer_token') {
          authConfig.value = { bearerToken: auth.bearerToken as string };
        } else if (server.authType === 'custom') {
          authConfig.value = { custom: JSON.stringify(auth, null, 2) };
        }
      }
    } catch (e) {
      console.warn('Failed to parse auth config:', e);
    }
  }

  serverFormErrors.value = {};
  showServerDialog.value = true;
}

function cancelServerDialog() {
  showServerDialog.value = false;
  editingServer.value = null;
  inputMode.value = 'form';
  jsonInput.value = '';
  serverForm.value = {};
  authConfig.value = {};
  serverFormErrors.value = {};
}

function loadExampleJson() {
  jsonInput.value = `{
  "mcpServers": {
    "blender": {
      "command": "uvx",
      "args": [
        "blender-mcp"
      ]
    }
  }
}`;
}

function validateServerForm(): boolean {
  serverFormErrors.value = {};
  let valid = true;

  if (inputMode.value === 'json') {
    if (!jsonInput.value.trim()) {
      serverFormErrors.value.jsonInput = 'JSON configuration is required';
      valid = false;
    } else {
      try {
        const parsed = JSON.parse(jsonInput.value);
        if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
          serverFormErrors.value.jsonInput = 'Invalid format: must contain "mcpServers" object';
          valid = false;
        } else {
          const servers = parsed.mcpServers;
          const serverKeys = Object.keys(servers);
          if (serverKeys.length === 0) {
            serverFormErrors.value.jsonInput = 'At least one server configuration is required';
            valid = false;
          }
        }
      } catch (e) {
        serverFormErrors.value.jsonInput = `Invalid JSON: ${e instanceof Error ? e.message : 'Parse error'}`;
        valid = false;
      }
    }
    return valid;
  }

  if (!serverForm.value.serverName?.trim()) {
    serverFormErrors.value.serverName = 'Server name is required';
    valid = false;
  }

  if (!serverForm.value.host?.trim()) {
    serverFormErrors.value.host = serverForm.value.transport === 'stdio' ? 'Command is required' : 'Host is required';
    valid = false;
  }

  if (serverForm.value.transport !== 'stdio' && !serverForm.value.port) {
    serverFormErrors.value.port = 'Port is required for this transport type';
    valid = false;
  }

  return valid;
}

function parseJsonConfig(): MCPServerConfig[] {
  const parsed = JSON.parse(jsonInput.value);
  const mcpServers = parsed.mcpServers as Record<string, {
    command?: string;
    args?: string[];
    url?: string;
    host?: string;
    port?: number;
    transport?: string;
    enabled?: boolean;
    authType?: string;
    authConfig?: Record<string, unknown>;
    timeout?: number;
  }>;

  const configs: MCPServerConfig[] = [];

  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    let transport: "stdio" | "sse" | "websocket" = "stdio";
    let host = '';
    let port: number | undefined = undefined;

    // Determine transport type and connection details
    if (serverConfig.command) {
      // Stdio transport - combine command and args into host field
      // MCPClient expects host to contain the full command string
      transport = "stdio";
      if (serverConfig.args && serverConfig.args.length > 0) {
        // Combine command and args: "command arg1 arg2"
        host = `${serverConfig.command} ${serverConfig.args.join(' ')}`;
      } else {
        host = serverConfig.command;
      }
    } else if (serverConfig.url) {
      // Parse URL to determine transport
      const url = new URL(serverConfig.url);
      if (url.protocol === 'ws:' || url.protocol === 'wss:') {
        transport = "websocket";
      } else if (url.protocol === 'http:' || url.protocol === 'https:') {
        transport = "sse";
      }
      host = url.hostname;
      port = url.port ? parseInt(url.port, 10) : undefined;
    } else if (serverConfig.host) {
      // Explicit host/port
      host = serverConfig.host;
      port = serverConfig.port;
      transport = (serverConfig.transport as "stdio" | "sse" | "websocket") || "sse";
    } else {
      throw new Error(`Server "${serverName}" must have either "command", "url", or "host" property`);
    }

    const config: MCPServerConfig = {
      serverName,
      host,
      port,
      transport,
      enabled: serverConfig.enabled ?? true,
      authType: (serverConfig.authType as "none" | "api_key" | "bearer_token" | "custom") || "none",
      timeout: serverConfig.timeout || 30000
    };

    // Store original command/args in metadata for reference
    if (transport === "stdio" && serverConfig.args) {
      config.metadata = {
        originalCommand: serverConfig.command,
        originalArgs: serverConfig.args
      };
    }

    // Add auth config if provided
    if (serverConfig.authConfig) {
      config.authConfig = serverConfig.authConfig;
    }

    configs.push(config);
  }

  return configs;
}

async function saveServer() {
  if (!validateServerForm()) {
    return;
  }

  savingServer.value = true;
  try {
    if (inputMode.value === 'json') {
      // Parse JSON and add all servers
      const configs = parseJsonConfig();
      
      if (editingServer.value) {
        // Editing mode: only update the first server
        if (configs.length > 0) {
          await updateMCPServer(editingServer.value.id, configs[0]);
          showServerDialog.value = false;
          await loadServers();
        }
      } else {
        // Add mode: add all servers
        let successCount = 0;
        let errorCount = 0;
        const errors: string[] = [];
        
        for (const config of configs) {
          try {
            await addMCPServer(config);
            successCount++;
          } catch (error) {
            errorCount++;
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            errors.push(`${config.serverName}: ${errorMsg}`);
            console.error(`Failed to add server ${config.serverName}:`, error);
          }
        }
        
        if (errorCount === 0) {
          showServerDialog.value = false;
          await loadServers();
          if (successCount > 1) {
            alert(`Successfully added ${successCount} servers`);
          }
        } else {
          const errorMessage = `Added ${successCount} server(s), ${errorCount} failed:\n${errors.join('\n')}`;
          alert(errorMessage);
          if (successCount > 0) {
            await loadServers();
          }
        }
      }
    } else {
      // Form mode: existing logic
      const config: MCPServerConfig = {
        serverName: serverForm.value.serverName!,
        host: serverForm.value.host!,
        port: serverForm.value.port,
        transport: serverForm.value.transport!,
        enabled: serverForm.value.enabled ?? true,
        authType: serverForm.value.authType!,
        timeout: serverForm.value.timeout || 30000
      };

      // Add auth config
      if (config.authType === 'api_key' && authConfig.value.apiKey) {
        config.authConfig = { apiKey: authConfig.value.apiKey };
      } else if (config.authType === 'bearer_token' && authConfig.value.bearerToken) {
        config.authConfig = { bearerToken: authConfig.value.bearerToken };
      } else if (config.authType === 'custom' && authConfig.value.custom) {
        try {
          config.authConfig = JSON.parse(authConfig.value.custom);
        } catch (e) {
          serverFormErrors.value.authConfig = 'Invalid JSON';
          savingServer.value = false;
          return;
        }
      }

      if (editingServer.value) {
        await updateMCPServer(editingServer.value.id, config);
      } else {
        await addMCPServer(config);
      }

      showServerDialog.value = false;
      await loadServers();
    }
  } catch (error) {
    console.error('Error saving server:', error);
    if (inputMode.value === 'json') {
      serverFormErrors.value.jsonInput = error instanceof Error ? error.message : 'Failed to parse JSON configuration';
    } else {
      alert(error instanceof Error ? error.message : 'Failed to save server');
    }
  } finally {
    savingServer.value = false;
  }
}

function confirmDelete(server: MCPServer) {
  serverToDelete.value = server;
  showDeleteDialog.value = true;
}

async function deleteServer() {
  if (!serverToDelete.value) return;

  deletingServer.value = true;
  try {
    const response = await deleteMCPServer(serverToDelete.value.id);
    // if (response) {
    //   showDeleteDialog.value = false;
    //   await loadServers();
    // } else {
    //   alert( 'Failed to delete server');
    // }
  } catch (error) {
    console.error('Error deleting server:', error);
    alert('Failed to delete server');
  } finally {
    deletingServer.value = false;
    serverToDelete.value = null;
  }
}

async function toggleServer(id: number, enabled: boolean) {
  try {
    await toggleServerEnabled(id, enabled);
    await loadServers();
  } catch (error) {
    console.error('Error toggling server:', error);
    alert('Failed to toggle server');
  }
}

async function discoverTools(serverId: number) {
  discoveringServerId.value = serverId;
  try {
    const response = await discoverMCPTools(serverId);
    if (response) {
      await loadServers();
      // Expand server to show tools
      expandedServers.value.add(serverId);
    } else {
      alert('Failed to discover tools');
    }
  } catch (error) {
    console.error('Error discovering tools:', error);
    alert('Failed to discover tools');
  } finally {
    discoveringServerId.value = null;
  }
}

async function toggleTool(serverId: number, toolName: string, enabled: boolean) {
  try {
    await toggleToolEnabled(serverId, toolName, enabled);
    await loadServers();
  } catch (error) {
    console.error('Error toggling tool:', error);
    alert('Failed to toggle tool');
  }
}

async function testConnection(serverId: number) {
  testingServerId.value = serverId;
  try {
    const response = await testMCPConnection(serverId);
    if (response) {
      alert('Connection successful!');
    } else {
      alert( 'Failed to test connection');
    }
  } catch (error) {
    console.error('Error testing connection:', error);
    alert('Failed to test connection');
  } finally {
    testingServerId.value = null;
  }
}

function isToolEnabled(server: MCPServer, toolName: string): boolean {
  if (!server.toolConfig) return true;
  const toolConfig = server.toolConfig[toolName];
  return toolConfig?.enabled !== false;
}

function onTransportChange() {
  if (serverForm.value.transport === 'stdio') {
    serverForm.value.port = undefined;
  }
}

function onAuthTypeChange() {
  authConfig.value = {};
}

function toggleExpandServer(serverId: number) {
  if (expandedServers.value.has(serverId)) {
    expandedServers.value.delete(serverId);
  } else {
    expandedServers.value.add(serverId);
  }
}
</script>

<style scoped lang="scss">
.server-item {
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  
  &:hover {
    background-color: rgba(var(--v-theme-primary), 0.05);
  }
}

.tool-list {
  background-color: rgba(var(--v-theme-surface-variant), 0.3);
  border-radius: 4px;
  margin-top: 8px;
}

.tool-item {
  min-height: 40px;
}
</style>

