# RN-Native Design Workspace --- Product UI Decisions

## Product Philosophy

**A Project is a React Native application viewed through a designer's
language.**

There is no separate design file. The Git repository is the canonical
source of truth.

Designers interact with: - Projects - Flows - Screens - Components -
Design System - Assets

The system maps these directly to the underlying repository.

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

## Design Principles

-   Canvas is the hero.
-   Components are the universal primitive.
-   Project is the homebase.
-   Repository backs every interaction.
-   AI operates on the same objects as humans.
-   The interface should feel like a premium design tool, not an IDE.
