/**
 * GitHub Issues - Manage GitHub repository issues
 *
 * Provides tools to list, create, update, and comment on GitHub issues.
 * Requires a GitHub personal access token with repo scope.
 *
 * Common use cases:
 * - Issue tracking: "List all open issues in my repo"
 * - Bug reporting: "Create a new bug issue with details"
 * - Issue management: "Close issue #123 and add a comment"
 *
 * Example: listIssues({ owner: "user", repo: "project", state: "open" })
 *
 * Configuration:
 * - token: GitHub personal access token (required)
 * - baseUrl: GitHub API base URL (default: https://api.github.com)
 *
 * Dependencies are auto-installed on first run.
 *
 * @dependencies @octokit/rest@^20.0.0
 *
 * @version 1.0.0
 * @author Portel
 * @license MIT
 */

import { Octokit } from '@octokit/rest';

export default class GitHubIssues {
  private octokit: Octokit;

  constructor(
    private token: string,
    private baseUrl: string = 'https://api.github.com'
  ) {
    if (!token || token.trim() === '') {
      throw new Error('GitHub token is required');
    }

    this.octokit = new Octokit({
      auth: token,
      baseUrl,
    });
  }

  async onInitialize() {
    console.error('[github-issues] ✅ Initialized');
    console.error(`[github-issues] Base URL: ${this.baseUrl}`);
  }

  /**
   * List issues in a repository
   * @param owner Repository owner (username or organization)
   * @param repo Repository name
   * @param state Issue state filter (default: all)
   * @param labels Comma-separated label names to filter by
   * @param sort Sort by created, updated, or comments (default: created)
   * @param per_page Number of results per page (default: 30, max: 100)
   */
  async listIssues(params: {
    owner: string;
    repo: string;
    state?: 'open' | 'closed' | 'all';
    labels?: string;
    sort?: 'created' | 'updated' | 'comments';
    per_page?: number;
  }) {
    try {
      const response = await this.octokit.issues.listForRepo({
        owner: params.owner,
        repo: params.repo,
        state: params.state || 'all',
        labels: params.labels,
        sort: params.sort || 'created',
        per_page: params.per_page || 30,
      });

      const issues = response.data.map(issue => ({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        body: issue.body,
        labels: issue.labels.map((l: any) => (typeof l === 'string' ? l : l.name)),
        user: issue.user?.login,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        comments: issue.comments,
        html_url: issue.html_url,
      }));

      return {
        success: true,
        count: issues.length,
        issues,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get a single issue by number
   * @param owner Repository owner
   * @param repo Repository name
   * @param issue_number Issue number
   */
  async getIssue(params: { owner: string; repo: string; issue_number: number }) {
    try {
      const response = await this.octokit.issues.get({
        owner: params.owner,
        repo: params.repo,
        issue_number: params.issue_number,
      });

      const issue = response.data;

      return {
        success: true,
        issue: {
          number: issue.number,
          title: issue.title,
          state: issue.state,
          body: issue.body,
          labels: issue.labels.map((l: any) => (typeof l === 'string' ? l : l.name)),
          user: issue.user?.login,
          assignees: issue.assignees?.map(a => a.login),
          created_at: issue.created_at,
          updated_at: issue.updated_at,
          comments: issue.comments,
          html_url: issue.html_url,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Create a new issue
   * @param owner Repository owner
   * @param repo Repository name
   * @param title Issue title
   * @param body Issue description/body
   * @param labels Array of label names
   * @param assignees Array of usernames to assign
   */
  async createIssue(params: {
    owner: string;
    repo: string;
    title: string;
    body?: string;
    labels?: string[];
    assignees?: string[];
  }) {
    try {
      const response = await this.octokit.issues.create({
        owner: params.owner,
        repo: params.repo,
        title: params.title,
        body: params.body,
        labels: params.labels,
        assignees: params.assignees,
      });

      return {
        success: true,
        issue: {
          number: response.data.number,
          title: response.data.title,
          html_url: response.data.html_url,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Update an existing issue
   * @param owner Repository owner
   * @param repo Repository name
   * @param issue_number Issue number to update
   * @param title New title (optional)
   * @param body New body (optional)
   * @param state New state: open or closed (optional)
   * @param labels New labels (optional)
   */
  async updateIssue(params: {
    owner: string;
    repo: string;
    issue_number: number;
    title?: string;
    body?: string;
    state?: 'open' | 'closed';
    labels?: string[];
  }) {
    try {
      const response = await this.octokit.issues.update({
        owner: params.owner,
        repo: params.repo,
        issue_number: params.issue_number,
        title: params.title,
        body: params.body,
        state: params.state,
        labels: params.labels,
      });

      return {
        success: true,
        issue: {
          number: response.data.number,
          title: response.data.title,
          state: response.data.state,
          html_url: response.data.html_url,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Add a comment to an issue
   * @param owner Repository owner
   * @param repo Repository name
   * @param issue_number Issue number
   * @param body Comment text
   */
  async addComment(params: {
    owner: string;
    repo: string;
    issue_number: number;
    body: string;
  }) {
    try {
      const response = await this.octokit.issues.createComment({
        owner: params.owner,
        repo: params.repo,
        issue_number: params.issue_number,
        body: params.body,
      });

      return {
        success: true,
        comment: {
          id: response.data.id,
          body: response.data.body,
          user: response.data.user?.login,
          created_at: response.data.created_at,
          html_url: response.data.html_url,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * List comments on an issue
   * @param owner Repository owner
   * @param repo Repository name
   * @param issue_number Issue number
   */
  async listComments(params: { owner: string; repo: string; issue_number: number }) {
    try {
      const response = await this.octokit.issues.listComments({
        owner: params.owner,
        repo: params.repo,
        issue_number: params.issue_number,
      });

      const comments = response.data.map(comment => ({
        id: comment.id,
        body: comment.body,
        user: comment.user?.login,
        created_at: comment.created_at,
        updated_at: comment.updated_at,
        html_url: comment.html_url,
      }));

      return {
        success: true,
        count: comments.length,
        comments,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Search issues across repositories
   * @param query Search query (e.g., "is:open label:bug")
   * @param sort Sort by created, updated, or comments (default: created)
   * @param order Sort order: asc or desc (default: desc)
   * @param per_page Number of results per page (default: 30)
   */
  async searchIssues(params: {
    query: string;
    sort?: 'created' | 'updated' | 'comments';
    order?: 'asc' | 'desc';
    per_page?: number;
  }) {
    try {
      const response = await this.octokit.search.issuesAndPullRequests({
        q: params.query,
        sort: params.sort,
        order: params.order || 'desc',
        per_page: params.per_page || 30,
      });

      const issues = response.data.items.map(issue => ({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        repository: issue.repository_url.split('/').slice(-2).join('/'),
        labels: issue.labels.map((l: any) => (typeof l === 'string' ? l : l.name)),
        user: issue.user?.login,
        created_at: issue.created_at,
        html_url: issue.html_url,
      }));

      return {
        success: true,
        total_count: response.data.total_count,
        count: issues.length,
        issues,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
