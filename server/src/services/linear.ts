import { LinearClient } from "@linear/sdk";

export type IssueComment = {
  id: string;
  body: string;
  createdAt: Date;
  userId: string | null;
};

export type IssueDetails = {
  id: string;
  title: string;
  description: string | null;
  statusName: string | null;
  statusId: string | null;
  identifier: string;
  url: string;
  creatorName: string | null;
  comments: IssueComment[];
};

export function makeLinearClient(accessToken: string): LinearClient {
  return new LinearClient({ accessToken });
}

export async function fetchIssueWithComments(
  linear: LinearClient,
  issueId: string
): Promise<IssueDetails> {
  const issue = await linear.issue(issueId);
  const commentsPage = await issue.comments();

  const comments: IssueComment[] = commentsPage.nodes.map((c) => ({
    id: c.id,
    body: c.body,
    createdAt: c.createdAt,
    userId: c.userId ?? null,
  }));

  const state = await issue.state;
  const creator = await issue.creator;

  return {
    id: issue.id,
    title: issue.title,
    description: issue.description ?? null,
    statusName: state?.name ?? null,
    statusId: state?.id ?? null,
    identifier: issue.identifier,
    url: issue.url,
    creatorName: creator?.name ?? null,
    comments,
  };
}

export async function postComment(
  linear: LinearClient,
  issueId: string,
  body: string
): Promise<void> {
  await linear.createComment({ issueId, body });
}

/**
 * Posts the finalized plan as a comment on the Linear ticket.
 * Returns the created comment's ID so it can be stored in the DB.
 */
export async function postPlanComment(
  linear: LinearClient,
  issueId: string,
  body: string
): Promise<string> {
  const result = await linear.createComment({ issueId, body });
  const comment = await result.comment;
  if (!comment) throw new Error("Failed to create plan comment — no comment returned");
  return comment.id;
}

/**
 * Updates the body of an existing Linear comment (used to check off plan steps).
 */
export async function updateComment(
  linear: LinearClient,
  commentId: string,
  body: string
): Promise<void> {
  await linear.updateComment(commentId, { body });
}

/**
 * Fetches a Linear comment's body by its ID.
 */
export async function fetchComment(
  linear: LinearClient,
  commentId: string
): Promise<string> {
  const comment = await linear.comment({ id: commentId });
  return comment.body;
}

export async function postAgentActivity(
  linear: LinearClient,
  agentSessionId: string,
  body: string
): Promise<void> {
  await linear.createAgentActivity({
    agentSessionId,
    content: { type: "response", body },
  });
}

export async function updateIssueStatus(
  linear: LinearClient,
  issueId: string,
  organizationId: string,
  targetStateName: string
): Promise<void> {
  // Fetch all workflow states for the organization and find the target
  const issue = await linear.issue(issueId);
  const team = await issue.team;
  if (!team) {
    console.warn(`No team found for issue ${issueId}, skipping status update`);
    return;
  }

  const statesPage = await team.states();
  const targetState = statesPage.nodes.find(
    (s) => s.name.toLowerCase() === targetStateName.toLowerCase()
  );

  if (!targetState) {
    console.warn(
      `Status "${targetStateName}" not found for team ${team.id}. Available: ${statesPage.nodes.map((s) => s.name).join(", ")}`
    );
    return;
  }

  await linear.updateIssue(issueId, { stateId: targetState.id });
  console.log(`Issue ${issueId} status updated to "${targetState.name}"`);
}
