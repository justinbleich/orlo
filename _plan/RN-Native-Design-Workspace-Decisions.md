# RN-Native Design Workspace --- Product UI Decisions

## Product Philosophy

**A Project is a React Native application viewed through a designer's
language.**

There is no separate design file. The Git repository is the canonical
source of truth.

RN Studio is the editable object layer over the current Git branch. It
does not sit above Git as a separate canonical design source. Existing
repo code is read into designer-facing objects; new blank-slate designs
generate real React Native files into the working tree.

Designers interact with: - Projects - Flows - Screens - Components -
Design System - Assets

The system maps these directly to the underlying repository.

The product should feel like a design tool, but its persistence model is
branch-first:

-   Connect repo -> open an active design branch / worktree session ->
    read flows, screens, components, tokens and assets -> edit objects ->
    branch working tree changes -> commit / PR / push.
-   Start fresh -> create flows, screens, components, tokens and assets ->
    generate repo files into the active design branch -> branch working
    tree changes -> commit / PR / push.
-   Commit, PR and push are workflow endpoints, not the primary editing
    surface.

RN Studio never edits "the repo" abstractly. It edits the active design
branch / worktree. The soft default on repo connect is to treat the
current branch or worktree as the design session immediately, while
surfacing a Studio branch name that can become formal branch creation.
Autosync targets that active branch session.

## Canonical Mapping

  Designer Concept   Runtime
  ------------------ -----------------------
  Project            Git Repository
  Flow               Navigation Graph
  Screen             Route Component
  Component          React Component
  Design System      Tokens + Theme
  Asset              Repository Asset
  Preview            Native Simulator
  Share              Branch / Pull Request

## Object Ownership And Mutations

Repo-derived objects and Studio-created objects use the same product
language, but mutations resolve to different repo operations.

### Existing repo objects

If an object exists because it was read from the repo, changing it
changes the working tree on the current branch.

-   Flow -> navigation graph / route group changes.
-   Screen -> route component and associated RN Studio metadata.
-   Component -> React component and variants / props metadata.
-   Design System -> token and theme source files.
-   Asset -> repository asset file.

Deleting a repo-derived object is a code change, not just a navigator
cleanup. For example, deleting a `Checkout` flow inferred from
`app/checkout/*` implies removing or refactoring route files and any
navigation references. The UI should present that as an object-level
branch change with clear consequences.

### New Studio objects

If an object starts in RN Studio, it is local only until synced. Sync
generates the corresponding React Native source, metadata and supporting
files into the connected repo. After that, it should behave like any
other repo-derived object.

### Metadata

RN Studio metadata is implementation detail. Designers should not need to
understand sidecars or storage format to know whether something is
editable. If repo code is valid and within scope, it should be presented
as editable; the product can import, generate or update metadata behind
the scenes.

## Repo Index And Canvas Projection

RN Studio should not import a repo into a separate durable project model.
It should keep a lightweight repo index, then lazily project selected
objects into editable Canvas contexts.

-   Repo adapter -> detects stack and indexes candidate objects.
-   Object projector -> turns a selected repo object into an editable
    Studio view.
-   Canvas workspace -> renders the editable Flow, Screen, Component,
    Design System or Asset context.
-   Source writer -> applies edits back to code, tokens or assets on the
    active branch.
-   Git layer -> shows branch diff and commit / PR readiness.

The projection is disposable. If source changes, RN Studio re-projects
from source plus any uncommitted Studio-created drafts. It must not
become a competing source of truth.

Runtime preview is separate from editable Canvas rendering. Canvas first
renders the editable object projection; native simulator, Expo, or
React Native Web preview can later validate runtime behavior.

## Editability Parity Contract

Studio-created and existing-repo objects should converge to the same
editable shape. Git provides workspace truth; RN Studio provides the
designer-facing projection.

Every editable object should resolve to:

-   Object type: Flow, Screen, Component, Design System or Asset.
-   Source path or planned source path on the active branch.
-   Editable Canvas projection or object workspace.
-   Source writer that applies edits back to repo files.
-   Git status grouped at the object level.

Studio-created objects begin as Canvas drafts, then autosync into planned
repo paths on the active branch. Existing-repo objects begin as source
files, then project into Canvas. After sync/import, both should behave as
repo-backed editable objects rather than separate classes of product
object.

Native Git should own branch, worktree, status, diff, commit, push and PR
operations. RN Studio should present those operations in designer-friendly
language, but it should not recreate Git as a separate project layer.

## Primary Information Architecture

### Left

Project (homebase)

-   Flows
-   Screens
-   Components
-   Design System
-   Assets

Below Project lives a **Changes** panel showing activity, commits, AI
edits, branch state and PR readiness.

### Center

Canvas-first editing.

Frames represent real screens.

Selecting a Flow, Screen, Component or Design System object opens its
dedicated workspace.

### Right

Inspector

-   Layout
-   Typography
-   Tokens
-   Props
-   Variants
-   Accessibility
-   Usage

Designer language first.

### Bottom

Contextual tools:

-   Timeline
-   AI
-   Implementation
-   Simulator

Collapsed by default.

## Four Workspaces

### Screen Workspace

Design a complete screen.

### Component Workspace

Variant-driven editing for reusable components.

### Flow Workspace

Visual navigation editing backed by React Navigation/Expo Router.

### Design System Workspace

Visual editing for spacing, typography, colors, radius and other tokens.

## Code Philosophy

Canvas first.

Implementation second.

IDE third.

Default: - Inspect implementation - Preview source - View diff - Open in
IDE

Later: - Lightweight editing for Design Engineers

Avoid becoming a general-purpose IDE.

## Git Philosophy

Git is visible but ambient.

Expose: - Branch - Modified state - Timeline - Create PR - Activity

Avoid exposing low-level Git operations as primary UI.

Working tree changes should be grouped by design object where possible
so Git status reads like product work, not a raw file list.

## Design Principles

-   Canvas is the hero.
-   Components are the universal primitive.
-   Project is the homebase.
-   Repository backs every interaction.
-   AI operates on the same objects as humans.
-   The interface should feel like a premium design tool, not an IDE.
