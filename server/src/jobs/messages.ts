/** Randomly pick one item from an array. */
export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------------------------------------------------------------------------
// planningJob
// ---------------------------------------------------------------------------

export const msgRepoCheckoutFailed = (err: unknown): string =>
  pick([
    `🌵 Gnarly wipeout! Couldn't check out the repo. Make sure \`GITHUB_REPO_URL\` and \`GITHUB_TOKEN\` are dialed in, dude.\n\n\`\`\`\n${err}\n\`\`\``,
    `🌵 Wiped out before we even paddled out — repo checkout bailed. Double-check \`GITHUB_REPO_URL\` and \`GITHUB_TOKEN\` and try again, brah.\n\n\`\`\`\n${err}\n\`\`\``,
    `🌊 Ate it on the paddle-out! Couldn't clone the repo. Check \`GITHUB_REPO_URL\` and \`GITHUB_TOKEN\`, dude.\n\n\`\`\`\n${err}\n\`\`\``,
  ]);

export const msgCursorPlanFailed = (err: unknown): string =>
  pick([
    `🌵 Hit a gnarly wipeout while cooking up the plan. Peep the server logs for the full damage report.\n\n\`\`\`\n${err}\n\`\`\``,
    `🌊 Wiped out hard on the planning run. Check the server logs for what went sideways, dude.\n\n\`\`\`\n${err}\n\`\`\``,
    `🌵 Bailed out in the barrel — Cursor CLI ate it while planning. Server logs have the full story.\n\n\`\`\`\n${err}\n\`\`\``,
  ]);

export const msgCursorClarificationFailed = (err: unknown): string =>
  pick([
    `🌵 Wipeout while updating the plan. Check the server logs for the full lowdown.\n\n\`\`\`\n${err}\n\`\`\``,
    `🌊 Ate it updating the plan, dude. Server logs have the damage report.\n\n\`\`\`\n${err}\n\`\`\``,
    `🌵 Bailed on the plan update run. Peep the server logs for what went sideways.\n\n\`\`\`\n${err}\n\`\`\``,
  ]);

export const msgClarificationNeeded = (planRaw: string): string => {
  const intro = pick([
    "Stoked to paddle out on this one! Got the vibes flowing but need a few answers before I can lock in the plan. 🏄",
    "Rad ticket! I'm feeling the flow, just gotta clear up a couple of things before I drop in. 🏄",
    "Gnarly challenge! Stoked on the concept, but need some intel before I can shred this plan. 🌵",
  ]);
  const cta = pick([
    "_Drop your answers and I'll ride that wave to a finalized plan. 🌵_",
    "_Send the deets back and I'll lock in the line. 🌵_",
    "_Shoot me the answers and I'll be charging this wave in no time. 🏄_",
  ]);
  return `## Implementation Plan (Draft)\n\n${intro}\n\n${planRaw}\n\n---\n${cta}`;
};

export const msgMoreClarificationNeeded = (planRaw: string): string => {
  const intro = pick([
    "Sick, thanks for the intel! Still got a couple of gnarly questions before I can hang ten on this plan:",
    "Solid answers, brah! Just a few more details before I can lock this plan in:",
    "Rad feedback! Almost there — still need a couple more things before I can drop in:",
  ]);
  const cta = pick([
    "_Send it back and I'll paddle to a fully-locked plan. 🌵_",
    "_Fire back with the deets and I'll nail down the line. 🌵_",
    "_Drop the answers and I'll be shredding in no time. 🏄_",
  ]);
  return `## Updated Implementation Plan\n\n${intro}\n\n${planRaw}\n\n---\n${cta}`;
};

export const msgPlanApprovalCta = (): string =>
  pick([
    "_Stoked on this plan? Reply **approved** to drop in and start shredding, or send some feedback and I'll tweak the lines. 🌵_",
    "_Feeling this plan? Reply **approved** to paddle in and start shredding, or fire back with notes and I'll dial it in. 🏄_",
    "_Vibing with this plan? Hit me with **approved** to kick things off, or drop some feedback and I'll tune the board. 🌵_",
  ]);

export const msgApprovalReceived = (): string =>
  pick([
    "🤙 Rad! Plan approved — dropping in and shredding code now! 🌊",
    "🌊 Let's go! Plan approved — paddling in and shredding code! 🤙",
    "🌵 Cowabunga! Plan approved — dropping in hot and shredding! 🌊",
  ]);

// ---------------------------------------------------------------------------
// implementationJob
// ---------------------------------------------------------------------------

export const msgNoStepsFound = (): string =>
  pick([
    "🌵 Bummer, dude — no unchecked steps found in the plan comment. Wiped out before we even paddled in. Implementation cancelled.",
    "🌊 Wipeout at the start line — couldn't find any steps in the plan comment. Bailing on the implementation, dude.",
    "🌵 Gnarly miss — the plan comment has no unchecked steps. Nothing to shred, calling it here.",
  ]);

export const msgNewBranch = (branchName: string, branchUrl: string): string =>
  pick([
    `🌵 Fresh branch planted: [${branchName}](${branchUrl}) — dropping in and shredding code now! 🏄`,
    `🌊 New branch in the water: [${branchName}](${branchUrl}) — let's get shredding! 🤙`,
    `🌵 Just carved out a fresh line: [${branchName}](${branchUrl}) — charging the code now! 🏄`,
  ]);

export const msgResumeBranch = (branchName: string, branchUrl: string, resumeFromStep: number | string): string =>
  pick([
    `🌵 Paddling back out on [${branchName}](${branchUrl}) — resuming from Step ${resumeFromStep}. Cowabunga! 🏄`,
    `🌊 Back in the lineup on [${branchName}](${branchUrl}) — picking it up at Step ${resumeFromStep}, dude. 🤙`,
    `🌵 Dropping back into [${branchName}](${branchUrl}) — riding again from Step ${resumeFromStep}. Let's shred! 🏄`,
  ]);

export const msgStartingStep = (stepNumber: number, totalSteps: number, stepText: string): string =>
  pick([
    `🌊 Dropping in on step ${stepNumber}/${totalSteps}: ${stepText}…`,
    `🌊 Paddling into step ${stepNumber}/${totalSteps}: ${stepText}…`,
    `🌵 Charging step ${stepNumber}/${totalSteps}: ${stepText}… let's shred!`,
  ]);

export const msgStepComplete = (stepNumber: number, totalSteps: number, stepText: string): string =>
  pick([
    `✅ Shredded step ${stepNumber}/${totalSteps}: ${stepText} 🤙`,
    `✅ Step ${stepNumber}/${totalSteps} totally ripped: ${stepText} 🌊`,
    `✅ Stomped step ${stepNumber}/${totalSteps}: ${stepText} — gnarly! 🤙`,
  ]);

export const msgPrCreationFailed = (msg: string): string =>
  pick([
    `🌵 Gnarly wipeout at the finish line! Shredded all the steps but wiped out creating the PR, dude: ${msg}`,
    `🌊 So close! All steps shredded but bailed on the PR creation: ${msg}`,
    `🌵 Ate it on the last wave — all steps done but the PR creation wiped out: ${msg}`,
  ]);

// ---------------------------------------------------------------------------
// codeReviewJob
// ---------------------------------------------------------------------------

export const msgReviewStarting = (): string =>
  pick([
    "🌵 Hold up — gonna do a gnarly self-review before I paddle this wave over to the reviewer… dropping back in on the code now! 🏄",
    "🌊 Taking one last look before I send this to the reviewer — paddling back through the code! 🏄",
    "🌵 Before I hand this off, doing a quick barrel check on my own work… dropping back in now! 🤙",
  ]);

export const msgReviewHadFixes = (): string =>
  pick([
    "🌵 Cowabunga! Found a few gnarly bits and patched 'em up — fixes are pushed and the code is fully shredded! 🤙",
    "🌊 Found a couple of wiggly lines and straightened 'em out — patched and pushed, the set is clean now! 🤙",
    "🌵 Spotted a few kooks in the code and sent 'em packing — fixed up and pushed! 🤙",
  ]);

export const msgReviewClean = (): string =>
  pick([
    "🌵 Stoked! Reviewed the whole set and it's totally clean — no wipeouts detected, dude! 🤙",
    "🌊 Took a good look and it's all butter — code is clean, no fixes needed! 🤙",
    "🌵 Charged through the whole review and the line is perfect — no kooks in this code! 🤙",
  ]);

export const msgPrAnnounce = (prUrl: string, reviewer: string): string =>
  pick([
    `🌊 Cowabunga! All steps shredded and stoked! PR is hanging loose for review: [View PR](${prUrl}) — ${reviewer}, ready to catch this wave? 🌵`,
    `🌵 Gnarly work's all done! PR is up and waiting: [View PR](${prUrl}) — ${reviewer}, time to catch this wave? 🌊`,
    `🌊 All steps ripped and the PR is in the lineup: [View PR](${prUrl}) — ${reviewer}, ready to paddle out and review? 🌵`,
  ]);

// ---------------------------------------------------------------------------
// prCommentJob
// ---------------------------------------------------------------------------

export const msgPrCommentStarted = (): string =>
  pick([
    "🌵🏄 Gnarly request, dude — dropping in on the code now. Give me a sec to wax up and I'll be shredding through it shortly. Cowabunga!",
    "🌊 Caught that wave! Paddling out to the code right now — hang loose while I carve it up! 🤙",
    "🌵 Stoked on this request! Grabbing my board and charging the lineup — back with the goods shortly! 🌊",
  ]);

export const msgPrCommentDone = (hadChanges: boolean): string =>
  hadChanges
    ? pick([
        "🌊 Cowabunga! Shredded through it and pushed the changes — fresh commit is on the branch, dude! 🌵",
        "🌵 Gnarly! Carved up the code and pushed the fixes. New commit is live on the branch — catch that wave! 🤙",
        "🌊 Ripped it clean! Changes committed and pushed to the branch. All buttered up, brah! 🌵",
      ])
    : pick([
        "🌵 Took a good look and the barrel's already clean — no changes needed, dude! 🤙",
        "🌊 Paddled all the way out and the lineup is perfect — nothing to change here! 🌵",
        "🌵 Charged through the code and it's already fully shredded — no fixes required, brah! 🌊",
      ]);
