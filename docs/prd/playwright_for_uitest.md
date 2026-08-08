Here is a Product Requirements Document (PRD) tailored for implementing Playwright automated UI tests for an Electron application (including your AI agent features) within a GitHub Actions pipeline.

# **PRD: Automated Electron UI Testing Pipeline**

## **1\. Objective**

To establish a reliable, automated end-to-end (E2E) testing pipeline for our Electron desktop application. This pipeline will use Playwright to simulate user interactions and validate both the Chromium frontend (Renderer) and Node.js backend (Main process), running seamlessly on every Pull Request via GitHub Actions.

## **2\. Background & Context**

Currently, testing the Electron application requires manual effort, which is time-consuming and prone to human error. With the introduction of complex features like an AI Agent utilizing LLM function calls via Inter-Process Communication (IPC), the risk of regressions has increased. We need an automated safety net to ensure that UI components, IPC messaging, and native app behaviors function correctly before code is merged.

## **3\. Scope**

**In Scope:**

* Setting up Playwright with Electron-specific configurations (@playwright/test).  
* Writing core UI test suites, including mocking IPC responses for the AI Agent.  
* Configuring a GitHub Actions workflow using xvfb-run for headless execution.  
* Generating and storing HTML test reports as workflow artifacts.

**Out of Scope:**

* Testing actual, live API calls to the LLM (OpenAI/Anthropic) during CI runs (costs and flakiness).  
* Unit testing internal Node.js functions (handled by Jest/Vitest separately).  
* Cross-platform CI builds (Initial phase is Linux-only via Ubuntu runners).

## **4\. Requirements**

### **Functional Requirements**

| ID | Requirement | Priority | Description |
| :---- | :---- | :---- | :---- |
| **F-01** | **App Initialization** | High | Playwright must launch the compiled or dev-mode Electron binary using the \_electron namespace. |
| **F-02** | **UI Interaction** | High | Tests must be able to locate elements, click buttons, and type into inputs (e.g., the AI chat box). |
| **F-03** | **IPC Mocking** | High | Tests must intercept or mock IPC messages between the Renderer and Main process to simulate LLM function calls deterministically. |
| **F-04** | **Native Dialogs** | Medium | The framework must bypass or mock native OS dialogs (Save/Open files) injected via the Main process. |
| **F-05** | **CI Execution** | High | Tests must run automatically on GitHub Actions on every Pull Request targeting the main branch. |

### **Non-Functional Requirements**

| ID | Requirement | Priority | Description |
| :---- | :---- | :---- | :---- |
| **NF-01** | **Performance** | High | The entire CI test suite should complete in under 10 minutes to maintain developer velocity. |
| **NF-02** | **Reliability** | High | Tests must not be flaky. Real network calls to LLMs are banned in this suite. |
| **NF-03** | **Headless Environment** | High | The GitHub Actions runner must use xvfb to simulate a display server for Electron to boot successfully. |

## **5\. Technical Architecture**

* **Test Runner:** Playwright Test (@playwright/test).  
* **Electron Integration:** Playwright's experimental \_electron.launch() API.  
* **AI Agent Mocking Strategy:**  
  * Playwright will inject an evaluate script into the Electron Main process during setup.  
  * This script will replace the actual LLM API handler with a mock.  
  * When the UI sends an IPC message requesting an AI response, the mock immediately returns a predefined JSON function call payload.  
* **CI Infrastructure:** GitHub Actions (ubuntu-latest runner).  
* **Display Server:** xvfb-run (X virtual framebuffer) to run Electron in a headless Linux environment.

## **6\. Implementation Plan / Milestones**

**Phase 1: Local Setup & Proof of Concept**

> 1. Install @playwright/test and configure playwright.config.js for Electron.  
> 2. Write a "Smoke Test" that launches the app, asserts the window title, and closes.  
> 3. Verify the test runs successfully on a local developer machine.

**Phase 2: Core Test Development (AI Agent)**

> 1. Write a test asserting the chat box accepts input.  
> 2. Implement Main process IPC mocking using electronApp.evaluate().  
> 3. Write a test asserting that when the mock LLM returns a function call, the UI updates correctly (e.g., theme changes, file is parsed).

**Phase 3: CI/CD Integration**

> 1. Create .github/workflows/playwright.yml.  
> 2. Configure steps for Node setup, dependency installation, and npx playwright install-deps.  
> 3. Wrap the test command in xvfb-run.  
> 4. Configure artifact uploading for playwright-report.

**Phase 4: Review & Refine**

> 1. Intentionally break the app locally to ensure the CI test catches the failure.  
> 2. Review test execution times and add GitHub Actions dependency caching if necessary.

## **7\. Success Metrics**

* **CI Pass Rate:** \>95% on main branch over a 30-day period (indicating low flakiness).  
* **Coverage:** 100% of AI Agent function call variants have an associated automated UI test.  
* **Time to Resolution:** Developers can download the HTML report from a failed GitHub Action and identify the broken UI component in under 5 minutes.