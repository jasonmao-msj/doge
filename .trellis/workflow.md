# Development Workflow

> Based on [Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)

---

## Ownership

- `AGENTS.md`
  - 仓库级入口、规则优先级、最小读取路径、全局 gate
- `.trellis/workflow.md`
  - Trellis 的执行流程、命令顺序、task/session 生命周期
- `.trellis/spec/**`
  - frontend / backend / guides 的实现规范与检查清单
- `openspec/**`
  - behavior requirement、proposal / design / tasks、verify / sync / archive

---

## Table of Contents

1. [Quick Start (Do This First)](#quick-start-do-this-first)
2. [Workflow Overview](#workflow-overview)
3. [Session Start Process](#session-start-process)
4. [Development Process](#development-process)
5. [Session End](#session-end)
6. [File Descriptions](#file-descriptions)
7. [Best Practices](#best-practices)

---

## Quick Start (Do This First)

### Step 0: Initialize Developer Identity (First Time Only)

> **Multi-developer support**: Each developer/Agent needs to initialize their identity first

```bash
# Check if already initialized
python3 ./.trellis/scripts/get_developer.py

# If not initialized, run:
python3 ./.trellis/scripts/init_developer.py <your-name>
# Example: python3 ./.trellis/scripts/init_developer.py cursor-agent
```

This creates:
- `.trellis/.developer` - Your identity file (gitignored, not committed)
- `.trellis/workspace/<your-name>/` - Your personal workspace directory

**Naming suggestions**:
- Human developers: Use your name, e.g., `john-doe`
- Cursor AI: `cursor-agent` or `cursor-<task>`
- Claude Code: `claude-agent` or `claude-<task>`
- iFlow cli: `iflow-agent` or `iflow-<task>`

### Step 1: Understand Current Context

```bash
# Get full context in one command
python3 ./.trellis/scripts/get_context.py

# Or check manually:
python3 ./.trellis/scripts/get_developer.py      # Your identity
python3 ./.trellis/scripts/task.py list          # Active tasks
git status && git log --oneline -10              # Git state
```

### Step 2: Read Project Entry And Guideline Indexes

Start from the canonical repo entry, then expand into the relevant guideline indexes:

```bash
cat AGENTS.md

# Read relevant implementation indexes
cat .trellis/spec/frontend/index.md
cat .trellis/spec/backend/index.md
cat .trellis/spec/guides/index.md
```

If the task is about rule entry, documentation governance, ignore policy, or host hooks, also read:

```bash
cat .trellis/spec/guides/project-instruction-layering-guide.md
```

### Step 3: Before Coding - Read Specific Guidelines (Required)

Based on your task, read the **detailed** guideline files listed in each spec index's **Pre-Development Checklist**:

```bash
# The index points to specific files — read those, not just the index
cat .trellis/spec/frontend/component-guidelines.md
cat .trellis/spec/backend/error-handling.md
# etc. — based on what the relevant checklist points to
```

---

## Workflow Overview

### Core Principles

1. **Project Entry First** - Start from `AGENTS.md`, then enter the relevant Trellis/OpenSpec surface
2. **Process Over Memory** - Use task scripts, context scripts, and recorded workflow instead of ad-hoc recall
3. **Incremental Development** - Complete one task at a time
4. **Record Promptly** - Update tracking files immediately after completion
5. **Document Limits** - Keep each journal document within the configured size limit

### File System

```
.trellis/
|-- .developer           # Developer identity (gitignored)
|-- scripts/
|   |-- __init__.py          # Python package init
|   |-- common/              # Shared utilities (Python)
|   |   |-- __init__.py
|   |   |-- paths.py         # Path utilities
|   |   |-- developer.py     # Developer management
|   |   +-- git_context.py   # Git context implementation
|   |-- multi_agent/         # Multi-agent pipeline scripts
|   |   |-- __init__.py
|   |   |-- start.py         # Start worktree agent
|   |   |-- status.py        # Monitor agent status
|   |   |-- create_pr.py     # Create PR
|   |   +-- cleanup.py       # Cleanup worktree
|   |-- init_developer.py    # Initialize developer identity
|   |-- get_developer.py     # Get current developer name
|   |-- task.py              # Manage tasks
|   |-- get_context.py       # Get session context
|   +-- add_session.py       # One-click session recording
|-- workspace/           # Developer workspaces
|   |-- index.md         # Workspace index + Session template
|   +-- {developer}/     # Per-developer directories
|       |-- index.md     # Personal index (with @@@auto markers)
|       +-- journal-N.md # Journal files (sequential numbering)
|-- tasks/               # Task tracking
|   +-- {MM}-{DD}-{name}/
|       +-- task.json
|-- spec/                # Implementation rules
|   |-- frontend/        # Frontend guidelines
|   |   |-- index.md
|   |   +-- *.md
|   |-- backend/         # Backend guidelines
|   |   |-- index.md
|   |   +-- *.md
|   +-- guides/          # Thinking guides and governance boundaries
|       |-- index.md
|       |-- project-instruction-layering-guide.md
|       +-- *.md
+-- workflow.md             # This document
```

---

## Session Start Process

### Step 1: Get Session Context

Use the unified context script:

```bash
# Get all context in one command
python3 ./.trellis/scripts/get_context.py

# Or get JSON format
python3 ./.trellis/scripts/get_context.py --json
```

### Step 2: Read Development Guidelines [!] REQUIRED

Follow the canonical reading order in `AGENTS.md`, then read the corresponding Trellis docs:

```bash
cat AGENTS.md
cat .trellis/spec/frontend/index.md
cat .trellis/spec/backend/index.md
cat .trellis/spec/guides/index.md
```

### Step 3: Select Task to Develop

Use the task management script:

```bash
# List active tasks
python3 ./.trellis/scripts/task.py list

# Create new task (creates directory with task.json)
python3 ./.trellis/scripts/task.py create "<title>" --slug <task-name>
```

---

## Development Process

### Task Development Flow

```
1. Select or create OpenSpec change first
   --> openspec list
   --> openspec new change "<change-id>" (if needed)

2. Create or select Trellis task
   --> python3 ./.trellis/scripts/task.py create "<title>" --slug <name> or list
   --> Record linked OpenSpec change id in task title/description

3. Start task (mark as current)
   --> python3 ./.trellis/scripts/task.py start <name>
   --> Writes .trellis/.current-task; future sessions see it in <current-state>

4. Write code according to guidelines
   --> Read the specific docs pointed to by the relevant Pre-Development Checklist
   --> For cross-layer or governance tasks: read the relevant guide under .trellis/spec/guides/

5. Self-test
   --> 按 `.trellis/spec/guides/risk-based-test-strategy.md` 声明 L0–L3 verification level，运行受影响 surface 的 focused checks
   --> L4 全量 tests/build/smoke 由 Release/CI 执行，除非用户明确要求本地全量
   --> Manual feature testing

6. Commit code
   --> git add <files>
   --> Follow the commit gate defined in AGENTS.md
   --> Typical format: git commit -m "type(scope): 中文动宾短句"

7. Record session (mandatory after successful commit)
   --> Follow the Trellis Session Record gate in AGENTS.md
   --> python3 ./.trellis/scripts/get_context.py --mode record
   --> cat << 'EOF' | python3 ./.trellis/scripts/add_session.py --stdin --title "Title" --commit "hash"
       Task goal, main changes, affected modules, validation results, follow-ups
       EOF
   --> Verify the Trellis metadata commit and report both the code commit hash and record commit hash

8. Verify and close spec loop
   --> openspec validate --change "<change-id>" --strict
   --> openspec sync/archive based on release strategy

9. Finish task (clear current)
   --> python3 ./.trellis/scripts/task.py finish
   --> Only when the task is fully done; otherwise leave it set so the
       next session resumes where you left off
```

### Code Quality Checklist

**Must pass before commit**:
- [OK] 当前 verification level 要求的 focused lint/tests/contracts 通过
- [OK] Type checks pass（L2/L3 或 type/contract 影响时）
- [OK] Manual feature testing passes
- [OK] 已记录未运行的 L4 Release/CI 项

**Project-specific checks**:
- See `.trellis/spec/frontend/quality-guidelines.md` or `.trellis/spec/backend/quality-guidelines.md` as applicable

---

## Session End

### One-Click Session Recording

After code is committed, use:

```bash
python3 ./.trellis/scripts/get_context.py --mode record

python3 ./.trellis/scripts/add_session.py \
  --title "Session Title" \
  --commit "abc1234" \
  --summary "Brief summary"
```

This automatically:
1. Detects current journal file
2. Creates new file if 2000-line limit exceeded
3. Appends session content
4. Updates index.md (sessions count, history table)

For repo-wide constraints around developer resolution, path style, and mandatory record flow, follow `AGENTS.md`.

### Pre-end Checklist

Use `/trellis:finish-work` command to run through:
1. [OK] All code committed, commit message follows convention
2. [OK] Session recorded via `add_session.py`
3. [OK] No lint/test errors
4. [OK] Working directory clean (or WIP noted)
5. [OK] Spec docs updated if needed

---

## File Descriptions

### 1. workspace/ - Developer Workspaces

**Purpose**: Record each AI Agent session's work content

**Structure** (Multi-developer support):
```
workspace/
|-- index.md              # Main index (Active Developers table)
+-- {developer}/          # Per-developer directory
    |-- index.md          # Personal index (with @@@auto markers)
    +-- journal-N.md      # Journal files (sequential: 1, 2, 3...)
```

**When to update**:
- [OK] End of each session
- [OK] Complete important task
- [OK] Fix important bug

### 2. spec/ - Development Guidelines

**Purpose**: Documented standards for consistent development

**Structure** (Multi-doc format):
```
spec/
|-- frontend/           # Frontend docs (if applicable)
|   |-- index.md        # Start here
|   +-- *.md            # Topic-specific docs
|-- backend/            # Backend docs (if applicable)
|   |-- index.md        # Start here
|   +-- *.md            # Topic-specific docs
+-- guides/             # Thinking guides
    |-- index.md        # Start here
    +-- *.md            # Guide-specific docs
```

**When to update**:
- [OK] New pattern discovered
- [OK] Bug fixed that reveals missing guidance
- [OK] New convention established

### 3. Tasks - Task Tracking

Each task is a directory containing `task.json`:

```
tasks/
|-- 01-21-my-task/
|   +-- task.json
+-- archive/
    +-- 2026-01/
        +-- 01-15-old-task/
            +-- task.json
```

**Commands**:
```bash
python3 ./.trellis/scripts/task.py create "<title>" [--slug <name>]   # Create task directory
python3 ./.trellis/scripts/task.py start <name>    # Set as current task (writes .current-task, triggers after_start hooks)
python3 ./.trellis/scripts/task.py finish          # Clear current task (triggers after_finish hooks)
python3 ./.trellis/scripts/task.py archive <name>  # Archive to archive/{year-month}/
python3 ./.trellis/scripts/task.py list            # List active tasks
python3 ./.trellis/scripts/task.py list-archive    # List archived tasks
```

**Current task mechanism**: `task.py start <name>` writes the selected task path to `.trellis/.current-task`. The SessionStart hook reads this file to inject `## CURRENT TASK` into every new session's context, so the AI immediately knows what you're working on without being told. Run `task.py finish` when you're done — subsequent sessions will show `(none)` until you start another task.

---

## Best Practices

### [OK] DO - Should Do

1. **Before session start**:
   - Run `python3 ./.trellis/scripts/get_context.py` for full context
   - Read `AGENTS.md`, then the relevant Trellis/OpenSpec docs for the task

2. **During development**:
   - Follow the specific guideline files referenced by the relevant index checklists
   - For cross-layer features, use `/trellis:check-cross-layer`
   - Develop only one task at a time
   - Run lint and tests frequently

3. **After development complete**:
   - Use `/trellis:finish-work` for completion checklist
   - After fix bug, use `/trellis:break-loop` for deep analysis
   - Follow `AGENTS.md` for commit and session-record gates
   - Use `add_session.py` to record progress

### [X] DON'T - Should Not Do

1. [!] **Don't** skip `AGENTS.md` or the relevant Trellis/OpenSpec docs
2. [!] **Don't** let journal single file exceed 2000 lines
3. **Don't** develop multiple unrelated tasks simultaneously
4. **Don't** commit code with lint/test errors
5. **Don't** forget to update spec docs after learning something
6. **Don't** duplicate repo-wide gate wording here when the canonical rule already lives in `AGENTS.md`

---

## Quick Reference

### Must-read Before Development

| Task Type | Must-read Document |
|-----------|-------------------|
| Frontend work | `AGENTS.md` → `.trellis/spec/frontend/index.md` → relevant docs |
| Backend work | `AGENTS.md` → `.trellis/spec/backend/index.md` → relevant docs |
| Cross-Layer Feature | `AGENTS.md` → `.trellis/spec/guides/index.md` → relevant guides |
| Governance / rule entry | `AGENTS.md` → `.trellis/spec/guides/project-instruction-layering-guide.md` |

### Common Commands

```bash
# Session management
python3 ./.trellis/scripts/get_context.py    # Get full context
python3 ./.trellis/scripts/add_session.py    # Record session

# Task management
python3 ./.trellis/scripts/task.py list      # List tasks
python3 ./.trellis/scripts/task.py create "<title>" # Create task

# Slash commands
/trellis:finish-work          # Pre-commit checklist
/trellis:break-loop           # Post-debug analysis
/trellis:check-cross-layer    # Cross-layer verification
```

---

## Summary

Following this workflow ensures:
- [OK] Continuity across multiple sessions
- [OK] Consistent code quality
- [OK] Trackable progress
- [OK] Knowledge accumulation in spec docs
- [OK] Transparent team collaboration

**Core Philosophy**: Start from the project entry, follow the process, record promptly, capture learnings
