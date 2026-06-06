import { useState, useEffect } from 'react';
import { SiJirasoftware, SiLinear, SiGithub } from '@icons-pack/react-simple-icons';
import { Check, X, Loader } from 'lucide-react';

interface Props {
  onSettingChange?: (key: string, value: any) => void;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  fontSize: 12,
  background: 'var(--surface-2)',
  color: 'var(--text)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
  fontFamily: 'inherit',
};

const buttonStyle: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 12,
  background: 'var(--surface-3)',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
};

const sectionStyle: React.CSSProperties = {
  marginBottom: 24,
  paddingBottom: 24,
  borderBottom: '1px solid var(--border-hairline)',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  color: 'var(--text-muted)',
  marginBottom: 4,
  fontWeight: 500,
};

const fieldStyle: React.CSSProperties = {
  marginBottom: 10,
};

export default function IntegrationsPage({ onSettingChange }: Props) {
  // Jira
  const [jiraDomain, setJiraDomain] = useState('');
  const [jiraEmail, setJiraEmail] = useState('');
  const [jiraToken, setJiraToken] = useState('');
  const [jiraTest, setJiraTest] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');

  // Linear
  const [linearKey, setLinearKey] = useState('');
  const [linearTest, setLinearTest] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');

  // GitHub
  const [githubUser, setGithubUser] = useState<string | null>(null);

  useEffect(() => {
    window.sai.settingsGet('jira_domain', '').then(setJiraDomain);
    window.sai.settingsGet('jira_email', '').then(setJiraEmail);
    window.sai.settingsGet('jira_api_token', '').then(setJiraToken);
    window.sai.settingsGet('linear_api_key', '').then(setLinearKey);
    window.sai.githubGetUser?.().then((u: any) => {
      if (u?.login) setGithubUser(u.login);
    }).catch(() => {});
  }, []);

  const saveJira = () => {
    window.sai.settingsSet('jira_domain', jiraDomain);
    window.sai.settingsSet('jira_email', jiraEmail);
    window.sai.settingsSet('jira_api_token', jiraToken);
    onSettingChange?.('jira_domain', jiraDomain);
  };

  const testJira = async () => {
    saveJira();
    setJiraTest('testing');
    try {
      const res = await window.sai.jiraTest();
      setJiraTest(res.ok ? 'ok' : 'fail');
    } catch { setJiraTest('fail'); }
  };

  const saveLinear = () => {
    window.sai.settingsSet('linear_api_key', linearKey);
    onSettingChange?.('linear_api_key', linearKey);
  };

  const testLinear = async () => {
    saveLinear();
    setLinearTest('testing');
    try {
      const res = await window.sai.linearTest();
      setLinearTest(res.ok ? 'ok' : 'fail');
    } catch { setLinearTest('fail'); }
  };

  return (
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: 'var(--text)' }}>
        Issue Tracker Integrations
      </h3>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.5 }}>
        Connect issue trackers to see rich previews when Jira, Linear, or GitHub issue URLs appear in chat.
      </p>

      {/* Jira Cloud */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <SiJirasoftware size={18} color="#2684FF" />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Jira Cloud</span>
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Domain</label>
          <input
            style={inputStyle}
            placeholder="mycompany.atlassian.net"
            value={jiraDomain}
            onChange={e => setJiraDomain(e.target.value)}
            onBlur={saveJira}
          />
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Email</label>
          <input
            style={inputStyle}
            placeholder="you@company.com"
            value={jiraEmail}
            onChange={e => setJiraEmail(e.target.value)}
            onBlur={saveJira}
          />
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>API Token</label>
          <input
            style={inputStyle}
            type="password"
            placeholder="Your Jira API token"
            value={jiraToken}
            onChange={e => setJiraToken(e.target.value)}
            onBlur={saveJira}
          />
        </div>
        <button type="button" style={buttonStyle} onClick={testJira}>
          {jiraTest === 'testing' && <Loader size={12} className="link-preview-spinner" />}
          {jiraTest === 'ok' && <Check size={12} color="#3fb950" />}
          {jiraTest === 'fail' && <X size={12} color="#f85149" />}
          Test Connection
        </button>
      </div>

      {/* Linear */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <SiLinear size={18} color="#5E6AD2" />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Linear</span>
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>API Key</label>
          <input
            style={inputStyle}
            type="password"
            placeholder="lin_api_..."
            value={linearKey}
            onChange={e => setLinearKey(e.target.value)}
            onBlur={saveLinear}
          />
        </div>
        <button type="button" style={buttonStyle} onClick={testLinear}>
          {linearTest === 'testing' && <Loader size={12} className="link-preview-spinner" />}
          {linearTest === 'ok' && <Check size={12} color="#3fb950" />}
          {linearTest === 'fail' && <X size={12} color="#f85149" />}
          Test Connection
        </button>
      </div>

      {/* GitHub Issues */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <SiGithub size={18} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>GitHub Issues</span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          {githubUser
            ? <>Authenticated as <strong style={{ color: 'var(--text)' }}>{githubUser}</strong>. GitHub issue previews are enabled.</>
            : <>Sign in with GitHub in the General settings to enable issue previews.</>
          }
        </p>
      </div>
    </div>
  );
}
