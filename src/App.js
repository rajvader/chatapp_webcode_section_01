import { useState } from 'react';
import Auth from './components/Auth';
import Chat from './components/Chat';
import YouTubeDownload from './components/YouTubeDownload';
import './App.css';

function App() {
  const [user, setUser] = useState(() => localStorage.getItem('chatapp_user'));
  const [firstName, setFirstName] = useState(() => localStorage.getItem('chatapp_firstName') || '');
  const [lastName, setLastName] = useState(() => localStorage.getItem('chatapp_lastName') || '');
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('chatapp_active_tab') || 'chat');

  const switchTab = (tab) => {
    localStorage.setItem('chatapp_active_tab', tab);
    setActiveTab(tab);
  };

  const handleLogin = (username, first = '', last = '') => {
    localStorage.setItem('chatapp_user', username);
    localStorage.setItem('chatapp_firstName', first);
    localStorage.setItem('chatapp_lastName', last);
    setUser(username);
    setFirstName(first);
    setLastName(last);
  };

  const handleLogout = () => {
    localStorage.removeItem('chatapp_user');
    localStorage.removeItem('chatapp_firstName');
    localStorage.removeItem('chatapp_lastName');
    localStorage.removeItem('chatapp_active_tab');
    setUser(null);
    setFirstName('');
    setLastName('');
    setActiveTab('chat');
  };

  if (user) {
    return (
      <div className="app-with-tabs">
        <nav className="tab-bar">
          <button
            className={`tab-btn${activeTab === 'chat' ? ' active' : ''}`}
            onClick={() => switchTab('chat')}
          >
            💬 Chat
          </button>
          <button
            className={`tab-btn${activeTab === 'youtube' ? ' active' : ''}`}
            onClick={() => switchTab('youtube')}
          >
            📺 YouTube Channel Download
          </button>
          <div className="tab-spacer" />
          <span className="tab-user">{firstName || user}</span>
          <button className="tab-logout" onClick={handleLogout}>Log out</button>
        </nav>
        <div className={`tab-content ${activeTab === 'youtube' ? 'youtube-tab' : ''}`}>
          {/* Keep Chat mounted but hide it when not active */}
          <div style={{ display: activeTab === 'chat' ? 'block' : 'none', height: '100%' }}>
            <Chat username={user} firstName={firstName} lastName={lastName} onLogout={handleLogout} activeTab={activeTab} />
          </div>
          
          {/* Keep YouTube mounted but hide it when not active */}
          <div style={{ display: activeTab === 'youtube' ? 'block' : 'none', height: '100%' }}>
            <YouTubeDownload onSwitchToChat={() => switchTab('chat')} />
          </div>
        </div>
      </div>
    );
  }
  return <Auth onLogin={handleLogin} />;
}

export default App;
