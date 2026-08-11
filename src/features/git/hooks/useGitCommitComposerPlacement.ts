import { useEffect, useState } from "react";
import {
  getClientStoreSync,
  writeClientStoreValue,
} from "../../../services/clientStorage";

export type GitCommitComposerPlacement = "bottom" | "top";

export const GIT_COMMIT_COMPOSER_PLACEMENT_KEY =
  "git.commitComposerPlacement";

const GIT_COMMIT_COMPOSER_PLACEMENT_EVENT =
  "doge:git-commit-composer-placement";

export function normalizeGitCommitComposerPlacement(
  value: unknown,
): GitCommitComposerPlacement {
  return value === "top" ? "top" : "bottom";
}

export function readGitCommitComposerPlacement(): GitCommitComposerPlacement {
  return normalizeGitCommitComposerPlacement(
    getClientStoreSync<unknown>("layout", GIT_COMMIT_COMPOSER_PLACEMENT_KEY),
  );
}

export function writeGitCommitComposerPlacement(
  placement: GitCommitComposerPlacement,
): void {
  writeClientStoreValue("layout", GIT_COMMIT_COMPOSER_PLACEMENT_KEY, placement);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<GitCommitComposerPlacement>(
        GIT_COMMIT_COMPOSER_PLACEMENT_EVENT,
        { detail: placement },
      ),
    );
  }
}

export function useGitCommitComposerPlacement(): GitCommitComposerPlacement {
  const [placement, setPlacement] = useState(readGitCommitComposerPlacement);

  useEffect(() => {
    const handlePlacementChange = (event: Event) => {
      setPlacement(
        normalizeGitCommitComposerPlacement(
          event instanceof CustomEvent ? event.detail : undefined,
        ),
      );
    };
    window.addEventListener(
      GIT_COMMIT_COMPOSER_PLACEMENT_EVENT,
      handlePlacementChange,
    );
    return () => {
      window.removeEventListener(
        GIT_COMMIT_COMPOSER_PLACEMENT_EVENT,
        handlePlacementChange,
      );
    };
  }, []);

  return placement;
}
