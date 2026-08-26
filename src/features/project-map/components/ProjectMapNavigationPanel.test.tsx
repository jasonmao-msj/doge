// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createProjectMapDatasetFixture,
  createProjectMapRelationFixture,
} from "../testUtils/fixtures";
import {
  buildProjectMapShortestPath,
  explainProjectMapAssociationPath,
} from "../utils/navigation";
import { ProjectMapNavigationPanel } from "./ProjectMapNavigationPanel";

afterEach(() => {
  cleanup();
});

describe("ProjectMapNavigationPanel", () => {
  it("shows path association explanations inside a collapsed details block", () => {
    const dataset = createProjectMapDatasetFixture({
      relations: [createProjectMapRelationFixture()],
    });
    const pathResult = buildProjectMapShortestPath({
      dataset,
      sourceNodeId: "api-controller",
      targetNodeId: "data-store",
      emptyMessage: "empty",
      foundMessage: "found",
      notFoundMessage: "not-found",
    });
    const associationExplanation = explainProjectMapAssociationPath({
      sourceNodeId: "api-controller",
      targetNodeId: "data-store",
      pathResult,
    });

    render(
      <ProjectMapNavigationPanel
        searchQuery=""
        expanded
        pathNodeOptions={dataset.nodes}
        pathSourceNodeId="api-controller"
        pathTargetNodeId="data-store"
        pathResult={pathResult}
        associationExplanation={associationExplanation}
        onSearchQueryChange={vi.fn()}
        onFocusNode={vi.fn()}
        onPathSourceNodeChange={vi.fn()}
        onPathTargetNodeChange={vi.fn()}
      />,
    );

    const summary = screen.getByText("projectMap.navigation.path.explain");
    const details = summary.closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);

    fireEvent.click(summary);

    expect(details.open).toBe(true);
    expect(within(details).getByText(/relation/i)).toBeTruthy();
  });
});
