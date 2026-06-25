To make your desktop app compatible with skills from marketplaces like **SkillsMP.com**, you need to adopt a **standardized manifest and execution pattern**.

Most modern AI skill platforms follow the **Open Agent Skills** standard or the **Model Context Protocol (MCP)**. These rely on a SKILL.md or manifest.json file that uses **JSON Schema** to describe what the skill does to the AI.

### ---

**1\. The Standard Skill Structure**

To be compatible with external sources, your app should expect a folder (or a .zip file) containing at least two things:

1. **The Manifest (skill.json or SKILL.md):** Tells your FastAPI server *how* to call the skill.  
2. **The Code (main.py or index.js):** The actual logic that Electron will run.

**Example skill.json (Open Standard):**

JSON

{  
  "name": "google\_search",  
  "description": "Searches Google for real-time information",  
  "parameters": {  
    "type": "object",  
    "properties": {  
      "query": { "type": "string", "description": "The search term" }  
    },  
    "required": \["query"\]  
  },  
  "runtime": "python",   
  "entry": "main.py"  
}

### ---

**2\. UI for Importing Skills**

In Electron, the "Import" flow should handle the file system operations and "register" the skill in your app's local database (like SQLite or a simple JSON file).

#### **A. The Frontend (React/Vue/HTML)**

Create a simple "Plugins" or "Skills" page with an "Add Skill" button.

JavaScript

async function handleImport() {  
  // 1\. Open File Dialog  
  const filePath \= await window.electron.openFileDialog();   
    
  if (filePath) {  
    // 2\. Send to Main Process to unzip and register  
    const result \= await window.electron.importSkill(filePath);  
    alert(result.success ? "Skill added\!" : "Error: " \+ result.message);  
  }  
}

#### **B. The Main Process (Node.js)**

Use adm-zip to extract the skill into your app's userData folder. This keeps skills persistent even after app updates.

JavaScript

const { app, dialog } \= require('electron');  
const path \= require('path');  
const fs \= require('fs-extra');  
const AdmZip \= require('adm-zip');

ipcMain.handle('import-skill', async (event, zipPath) \=\> {  
  try {  
    const dest \= path.join(app.getPath('userData'), 'installed\_skills');  
    const zip \= new AdmZip(zipPath);  
      
    // Extract to the skills folder  
    zip.extractAllTo(dest, true);  
      
    // Read the manifest to verify it  
    const manifestPath \= path.join(dest, 'skill.json');  
    const manifest \= await fs.readJson(manifestPath);  
      
    return { success: true, name: manifest.name };  
  } catch (err) {  
    return { success: false, message: err.message };  
  }  
});

### ---

**3\. Making it "Compatible" with the AI**

Since you have a FastAPI server, it needs to know these local skills exist so it can tell Electron to run them.

1. **Syncing:** When Electron starts, it reads all skill.json files in its local folder and sends a list of "Available Tools" (the names and descriptions) to your FastAPI server.  
2. **Inference:** When the user chats, FastAPI sees the list of tools. If the user asks to "Search Google," FastAPI returns a "tool\_call" for Google Search.  
3. **Local Execution:** Electron matches Google Search to the local main.py it just imported and runs it using the **Child Process** or **Sandbox** methods we discussed.

### **Summary Checklist for Marketplace Compatibility**

* **Standardized Manifest:** Use JSON Schema for parameters (this is what OpenAI/Anthropic use).  
* **Version Control:** Check the version field in the manifest during import to handle updates.  
* **Isolation:** Always extract downloaded skills to a specific sub-folder in app.getPath('userData') to prevent them from interfering with your core app files.

\[Local skill management and execution flow in Electron\]

[Building a Desktop App with Electron, Vite, and SQLite](https://www.youtube.com/watch?v=GQvDNRBe4IU)

This tutorial provides a complete walkthrough of building a professional Electron application with local storage and IPC, which is essential for managing a local "Skills" database and file imports.

