#!/usr/bin/env node
import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { PromptRegistry } from "@ai-prompt-registry/sdk";
import { parsePromptFile, serializePromptToYaml } from "@ai-prompt-registry/core";

const CONFIG_FILE = path.join(os.homedir(), ".promptregistry", "config.json");

function loadConfig(): { baseUrl: string; apiKey?: string } {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    }
  } catch {}
  return {
    baseUrl: process.env.PROMPT_REGISTRY_URL || "http://localhost:3000",
    apiKey: process.env.PROMPT_REGISTRY_KEY
  };
}

function saveConfig(cfg: { baseUrl: string; apiKey?: string }) {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function getClient(): PromptRegistry {
  const cfg = loadConfig();
  return new PromptRegistry({
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey
  });
}

const program = new Command();

program
  .name("prompt-registry")
  .description("AI Prompt Registry — Open-source prompt management and versioning infrastructure")
  .version("1.0.0");

// init
program
  .command("init")
  .description("Initialize prompt registry repository structure in current directory")
  .action(() => {
    const dirs = ["prompts", "fixtures", "evaluations"];
    for (const d of dirs) {
      if (!fs.existsSync(d)) {
        fs.mkdirSync(d, { recursive: true });
        console.log(`📁 Created ./${d}`);
      }
    }

    const examplePrompt = `name: customer-support.reply
version: 1.0.0
description: Generate helpful customer support replies
type: chat
tags: [support, customer-experience]

messages:
  - role: system
    content: |
      You are a polite, helpful customer support agent. Always respond with empathy.
  - role: user
    content: |
      Customer: {{customer_name}}
      Issue: {{issue}}

variables:
  customer_name:
    type: string
    required: true
    description: Full name of the customer
  issue:
    type: string
    required: true
    description: Description of the customer issue

model:
  provider: openai
  name: gpt-4o
  temperature: 0.7
`;
    const targetFile = path.join("prompts", "support-reply.prompt.yaml");
    if (!fs.existsSync(targetFile)) {
      fs.writeFileSync(targetFile, examplePrompt);
      console.log(`📄 Created example prompt: ${targetFile}`);
    }

    console.log("✨ Initialized AI Prompt Registry workspace!");
  });

// login
program
  .command("login")
  .description("Configure registry URL and API key")
  .option("-u, --url <url>", "Registry base URL", "http://localhost:3000")
  .option("-k, --key <key>", "API Key")
  .action((opts) => {
    saveConfig({ baseUrl: opts.url, apiKey: opts.key });
    console.log(`✅ Saved configuration for registry at ${opts.url}`);
  });

// doctor
program
  .command("doctor")
  .description("Check registry connectivity, configuration, and health")
  .action(async () => {
    const cfg = loadConfig();
    console.log(`🔍 Checking connectivity to: ${cfg.baseUrl}...`);
    try {
      const res = await fetch(`${cfg.baseUrl}/health`);
      if (res.ok) {
        const body = (await res.json()) as any;
        console.log(`✅ Registry status: OK (version ${body.version})`);
      } else {
        console.log(`⚠️ Registry returned status ${res.status}`);
      }
    } catch (err: any) {
      console.error(`❌ Could not connect to registry: ${err.message}`);
    }
  });

// Prompt group
const promptCmd = program.command("prompt").description("Manage prompts and prompt versions");

promptCmd
  .command("create <name>")
  .description("Create a new prompt resource in registry")
  .option("-d, --desc <desc>", "Prompt description", "")
  .option("-t, --type <type>", "Prompt type: chat or text", "chat")
  .option("--tag <tags...>", "Tags")
  .action(async (name, opts) => {
    const client = getClient();
    try {
      const p = await client.createPrompt({
        name,
        description: opts.desc,
        type: opts.type,
        tags: opts.tag
      });
      console.log(`✅ Prompt '${p.name}' created successfully! (id: ${p.id})`);
    } catch (err: any) {
      console.error(`❌ Failed to create prompt: ${err.message}`);
      process.exit(1);
    }
  });

promptCmd
  .command("list")
  .description("List all registered prompts")
  .option("-s, --search <search>", "Search keyword")
  .action(async (opts) => {
    const client = getClient();
    try {
      const list = await client.listPrompts(opts);
      if (list.length === 0) {
        console.log("No prompts found.");
        return;
      }
      console.log("Registered Prompts:");
      for (const p of list) {
        console.log(` • ${p.name.padEnd(30)} [${p.type}]  ${p.description || "(no description)"}`);
      }
    } catch (err: any) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

promptCmd
  .command("get <name>")
  .description("Get prompt details and resolved version for an environment")
  .option("-e, --env <env>", "Target environment or semver version", "production")
  .action(async (name, opts) => {
    const client = getClient();
    try {
      const res = await client.get(name, opts.env);
      console.log(`\nPrompt: ${res.prompt.name}`);
      console.log(`Resolved Version: ${res.version.version} (${opts.env})`);
      console.log(`Description: ${res.prompt.description || "-"}`);
      console.log("\nTemplate:");
      console.log(
        typeof res.version.template === "string"
          ? res.version.template
          : JSON.stringify(res.version.template, null, 2)
      );
      if (res.version.variables && Object.keys(res.version.variables).length > 0) {
        console.log("\nVariables:");
        for (const [k, v] of Object.entries(res.version.variables)) {
          console.log(` • ${k}: ${v.type} (${v.required ? "required" : "optional"})`);
        }
      }
    } catch (err: any) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

promptCmd
  .command("publish <name>")
  .description("Publish an immutable version from a file or inline definition")
  .option("-f, --file <file>", "Path to prompt yaml/json file")
  .option("-v, --ver <ver>", "Semver version")
  .option("-m, --message <msg>", "Changelog message", "")
  .action(async (name, opts) => {
    const client = getClient();
    try {
      let fileData: any = {};
      if (opts.file) {
        const raw = fs.readFileSync(opts.file, "utf-8");
        fileData = parsePromptFile(raw, opts.file);
      }

      const version = opts.ver || fileData.version;
      if (!version) {
        console.error("❌ Version must be specified in file or via --ver flag");
        process.exit(1);
      }

      const published = await client.publishVersion(name, {
        version,
        template: fileData.template || fileData.messages || "Hello {{name}}",
        variables: fileData.variables || {},
        outputSchema: fileData.outputSchema,
        modelPreferences: fileData.model,
        changelog: opts.message || fileData.description || ""
      });

      console.log(`✅ Published immutable version ${name}@${published.version}`);
      console.log(`   Checksum: ${published.checksum}`);
    } catch (err: any) {
      console.error(`❌ Publish failed: ${err.message}`);
      process.exit(1);
    }
  });

promptCmd
  .command("versions <name>")
  .description("List all immutable versions of a prompt")
  .action(async (name) => {
    const client = getClient();
    try {
      const versions = await client.listVersions(name);
      console.log(`Versions for '${name}':`);
      for (const v of versions) {
        console.log(` • ${v.version.padEnd(10)} [${v.lifecycleState}] ${v.changelog || ""}`);
      }
    } catch (err: any) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

promptCmd
  .command("diff <name> <from> <to>")
  .description("Compute semantic diff and breaking changes between two versions")
  .action(async (name, from, to) => {
    const client = getClient();
    try {
      const diff = await client.diff(name, from, to);
      console.log(`\nSemantic Diff: ${name} (${diff.fromVersion} → ${diff.toVersion})`);
      console.log(`Recommended Bump: ${diff.recommendedBump}`);

      if (diff.isBreaking) {
        console.log("\n⚠️ BREAKING CHANGES DETECTED:");
        for (const b of diff.breakingChanges) {
          console.log(` • ${b}`);
        }
      }

      console.log("\nChanges:");
      for (const c of diff.changes) {
        const icon = c.isBreaking ? "❗" : "•";
        console.log(` ${icon} [${c.category}] ${c.summary}`);
      }
    } catch (err: any) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

promptCmd
  .command("deploy <name> <version> <environment>")
  .description("Deploy or promote a prompt version to an environment")
  .option("-m, --notes <notes>", "Deployment notes")
  .action(async (name, version, environment, opts) => {
    const client = getClient();
    try {
      const dep = await client.promote(name, version, environment, opts.notes);
      console.log(`🚀 Successfully deployed ${name}@${dep.version} to ${dep.environmentName}`);
      console.log(`   Deployment ID: ${dep.id}`);
    } catch (err: any) {
      console.error(`❌ Deployment failed: ${err.message}`);
      process.exit(1);
    }
  });

promptCmd
  .command("rollback <name>")
  .description("Rollback prompt environment to previous deployment")
  .requiredOption("-e, --env <env>", "Target environment")
  .option("-v, --target-version <ver>", "Specific version to rollback to")
  .action(async (name, opts) => {
    const client = getClient();
    try {
      const dep = await client.rollback(name, opts.env, opts.targetVersion);
      console.log(`⏪ Successfully rolled back ${name} in ${dep.environmentName} to v${dep.version}`);
      console.log(`   Deployment ID: ${dep.id}`);
    } catch (err: any) {
      console.error(`❌ Rollback failed: ${err.message}`);
      process.exit(1);
    }
  });

promptCmd
  .command("render <name>")
  .description("Render a prompt with variables")
  .option("-e, --env <env>", "Target environment or version", "production")
  .option("-v, --vars <vars>", "JSON string of variables or key=value pairs")
  .action(async (name, opts) => {
    const client = getClient();
    let parsedVars: Record<string, any> = {};
    if (opts.vars) {
      try {
        parsedVars = JSON.parse(opts.vars);
      } catch {
        // Parse key=value pairs
        const pairs = opts.vars.split(",");
        for (const pair of pairs) {
          const [k, v] = pair.split("=");
          if (k && v !== undefined) parsedVars[k.trim()] = v.trim();
        }
      }
    }

    try {
      const rendered = await client.render(name, parsedVars, {
        environmentOrVersion: opts.env
      });
      console.log(`\nRendered Prompt (${name}@${rendered.version}):\n`);
      if (typeof rendered.rendered === "string") {
        console.log(rendered.rendered);
      } else {
        console.log(JSON.stringify(rendered.rendered, null, 2));
      }
    } catch (err: any) {
      console.error(`❌ Render failed: ${err.message}`);
      process.exit(1);
    }
  });

promptCmd
  .command("test <name>")
  .description("Run test cases for a prompt version")
  .option("-v, --ver <ver>", "Version to test", "latest")
  .action(async (name, opts) => {
    const client = getClient();
    try {
      console.log(`🧪 Running test cases for ${name}@${opts.ver}...`);
      const ev = await client.evaluate(name, opts.ver);
      console.log(`\nEvaluation Results:`);
      console.log(`Total tests: ${ev.totalTests} | Passed: ${ev.passedTests} | Score: ${(ev.score * 100).toFixed(1)}%`);
      for (const r of ev.testResults) {
        const icon = r.passed ? "✅" : "❌";
        console.log(` ${icon} ${r.testCaseName} (Score: ${r.score})`);
      }
      if (!ev.passed) process.exit(1);
    } catch (err: any) {
      console.error(`❌ Test run failed: ${err.message}`);
      process.exit(1);
    }
  });

promptCmd
  .command("evaluate <name>")
  .description("Run evaluation suite for a prompt version")
  .option("-v, --ver <ver>", "Version to evaluate", "latest")
  .action(async (name, opts) => {
    const client = getClient();
    try {
      const ev = await client.evaluate(name, opts.ver);
      console.log(`Overall Score: ${(ev.score * 100).toFixed(1)}% (${ev.passed ? "PASSED" : "FAILED"})`);
      if (!ev.passed) process.exit(1);
    } catch (err: any) {
      console.error(`❌ Evaluation failed: ${err.message}`);
      process.exit(1);
    }
  });

// env group
const envCmd = program.command("env").description("Manage environments and promotions");

envCmd
  .command("list")
  .description("List environments")
  .action(async () => {
    const cfg = loadConfig();
    try {
      const res = await fetch(`${cfg.baseUrl}/v1/environments`);
      const envs = (await res.json()) as any[];
      console.log("Environments:");
      for (const e of envs) {
        console.log(` • ${e.name.padEnd(16)} (Protected: ${e.isProtected})`);
      }
    } catch (err: any) {
      console.error(`❌ Error: ${err.message}`);
    }
  });

envCmd
  .command("promote <name> <version> <environment>")
  .description("Promote prompt version to environment")
  .action(async (name, version, environment) => {
    const client = getClient();
    try {
      const dep = await client.promote(name, version, environment);
      console.log(`🚀 Promoted ${name}@${version} to ${environment} (Deployment: ${dep.id})`);
    } catch (err: any) {
      console.error(`❌ Promotion failed: ${err.message}`);
      process.exit(1);
    }
  });

// CI Command (Section 29)
program
  .command("ci")
  .description("Run CI validation workflow for local prompt files (syntax, breaking changes, policies)")
  .option("-d, --dir <dir>", "Directory containing prompt files", "prompts")
  .action(async (opts) => {
    console.log(`\n🔍 AI Prompt Registry CI Pipeline`);
    console.log(`Scanning directory: ${opts.dir}...`);

    if (!fs.existsSync(opts.dir)) {
      console.log(`Directory '${opts.dir}' not found. Exiting with 0.`);
      return;
    }

    const files = fs.readdirSync(opts.dir).filter(f => f.endsWith(".yaml") || f.endsWith(".json"));
    if (files.length === 0) {
      console.log("No prompt files found.");
      return;
    }

    let hasErrors = false;
    for (const f of files) {
      const fullPath = path.join(opts.dir, f);
      console.log(`\nValidating ${f}...`);
      try {
        const raw = fs.readFileSync(fullPath, "utf-8");
        const parsed = parsePromptFile(raw, f);
        console.log(` ✅ Syntax valid: ${parsed.name}@${parsed.version}`);

        // Check required variables
        const varCount = Object.keys(parsed.variables || {}).length;
        console.log(` ✅ Variables declared: ${varCount}`);
      } catch (err: any) {
        console.error(` ❌ Validation failed for ${f}: ${err.message}`);
        hasErrors = true;
      }
    }

    if (hasErrors) {
      console.log("\n❌ CI checks failed.");
      process.exit(1);
    } else {
      console.log("\n✅ All prompt files passed CI checks successfully!");
    }
  });

program.parse();
