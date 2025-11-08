/**
 * Content - Test photon for integration tests
 */
export default class Content {
  /**
   * Count words in text
   * @param text Text to count words in
   */
  async wordCount(params: { text: string }) {
    const words = params.text.trim().split(/\s+/).filter(w => w.length > 0);
    return `Word count: ${words.length}`;
  }

  /**
   * @Template
   * Code review prompt
   * @param language Programming language
   * @param code Code to review
   */
  async codeReview(params: { language: string; code: string }) {
    return {
      role: 'user' as const,
      content: {
        type: 'text' as const,
        text: `Please review this ${params.language} code:\n\n${params.code}`
      }
    };
  }

  /**
   * @Template
   * Git commit message prompt
   * @param changes Changes to commit
   */
  async commitPrompt(params: { changes: string }) {
    return {
      role: 'user' as const,
      content: {
        type: 'text' as const,
        text: `Generate a commit message for:\n${params.changes}`
      }
    };
  }

  /**
   * @Template
   * Pull request description prompt
   * @param title PR title
   * @param changes Changes in PR
   */
  async prDescription(params: { title: string; changes: string }) {
    return {
      role: 'user' as const,
      content: {
        type: 'text' as const,
        text: `Create a PR description for: ${params.title}\n\nChanges:\n${params.changes}`
      }
    };
  }

  /**
   * @Static api://docs
   * API documentation
   * @mimeType text/markdown
   */
  async apiDocs(params: {}) {
    return {
      mimeType: 'text/markdown' as const,
      text: '# API Documentation\n\nThis is the API docs.'
    };
  }

  /**
   * @Static config://settings
   * Configuration settings
   * @mimeType application/json
   */
  async configSettings(params: {}) {
    return {
      mimeType: 'application/json' as const,
      text: JSON.stringify({ setting: 'value' })
    };
  }

  /**
   * @Static readme://{projectType}
   * Project README by type
   * @param projectType Type of project (api, web, mobile)
   */
  async projectReadme(params: { projectType: string }) {
    const readmes: Record<string, string> = {
      api: '# API Project\n\nREST API project with endpoints.',
      web: '# Web Project\n\nFrontend web application.',
      mobile: '# Mobile Project\n\niOS and Android app.'
    };

    return {
      mimeType: 'text/markdown' as const,
      text: readmes[params.projectType] || '# Unknown Project Type'
    };
  }
}
