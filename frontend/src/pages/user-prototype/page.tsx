import {
  Avatar,
  Button,
  Card,
  Divider,
  Dropdown,
  Input,
  Layout,
  Nav,
  Space,
  Tag,
  Typography,
} from '@douyinfe/semi-ui'
import {
  IconApps,
  IconArrowRight,
  IconArrowUp,
  IconBolt,
  IconChevronDown,
  IconChevronUp,
  IconClose,
  IconCommentStroked,
  IconDesktop,
  IconExit,
  IconImage,
  IconLightningStroked,
  IconLikeHeart,
  IconMailStroked,
  IconPhoneStroked,
  IconPlus,
  IconPlusCircle,
  IconPuzzle,
  IconSearch,
  IconSettingStroked,
  IconShareStroked,
  IconSidebar,
  IconUserGroup,
} from '@douyinfe/semi-icons'
import { useMemo, useRef, useState } from 'react'
import './workbench.css'

type SideMenu = 'new' | 'skills' | 'automations'
type StoreTab = 'featured' | 'explore' | 'installed'

type SessionItem = {
  id: string
  title: string
  preview: string
  runtimeMode: 'local' | 'cloud'
  syncState: 'synced' | 'pending'
}

type SkillItem = {
  id: string
  title: string
  desc: string
  brand: string
  invocation: string
}

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
}

const sessionsSeed: SessionItem[] = [
  {
    id: 's1',
    title: '新会话',
    preview: '欢迎来到 OpenFoal 客户端。',
    runtimeMode: 'local',
    syncState: 'synced',
  },
  {
    id: 's2',
    title: '产品原型讨论',
    preview: '先把用户端首页结构拉出来。',
    runtimeMode: 'cloud',
    syncState: 'pending',
  },
  {
    id: 's3',
    title: '增长方案评审',
    preview: '分析 3 个渠道实验结果。',
    runtimeMode: 'local',
    syncState: 'synced',
  },
]

const skillCatalogSeed: SkillItem[] = [
  {
    id: 'skill-design-review',
    title: 'Design Review Copilot',
    desc: '审查界面一致性并输出改进建议。',
    brand: 'D',
    invocation: '/skill:design-review',
  },
  {
    id: 'skill-market-brief',
    title: 'Market Brief',
    desc: '汇总竞品更新并生成简报。',
    brand: 'M',
    invocation: '/skill:market-brief',
  },
  {
    id: 'skill-doc-assistant',
    title: 'Doc Assistant',
    desc: '把需求整理为研发可执行文档。',
    brand: 'A',
    invocation: '/skill:doc-assistant',
  },
  {
    id: 'skill-release-note',
    title: 'Release Notes',
    desc: '自动整理发布内容并按模块归类。',
    brand: 'R',
    invocation: '/skill:release-note',
  },
  {
    id: 'skill-feedback-cluster',
    title: 'Feedback Cluster',
    desc: '聚类用户反馈并输出优先级。',
    brand: 'F',
    invocation: '/skill:feedback-cluster',
  },
  {
    id: 'skill-qna',
    title: 'Q&A Companion',
    desc: '基于知识库生成问答建议。',
    brand: 'Q',
    invocation: '/skill:qna',
  },
]

const recommendationCards = [
  {
    label: 'PROMPTS WE LOVE',
    title: 'Moltbook Where AI\nAgents Gather',
    desc: 'Agents join a "Reddit" forum.',
    tone: 'moltbook',
  },
  {
    label: 'SKILLS WE LOVE',
    title: 'Slides as a Web\nExperience',
    desc: 'Design slides like a living interface.',
    tone: 'slides',
  },
  {
    label: 'SKILLS WE LOVE',
    title: 'The Committee\nTechnique',
    desc: 'Seven experts stress-test your AI outputs.',
    tone: 'committee',
  },
] as const

const featureCards = [
  {
    title: 'Skills',
    desc: 'Build reusable workflows for daily tasks',
    tone: 'skills',
    icon: <IconPuzzle />,
  },
  {
    title: 'Automations',
    desc: 'Schedule recurring runs and reports',
    tone: 'automations',
    icon: <IconLightningStroked />,
  },
  {
    title: 'Teams',
    desc: 'Collaborate with role-based agents',
    tone: 'teams',
    icon: <IconUserGroup />,
  },
] as const

const quickActions = [
  { text: 'Join Moltbook', icon: <IconLikeHeart /> },
  { text: 'Create Skill', icon: <IconPuzzle /> },
  { text: 'Nano Banana', icon: <IconImage /> },
  { text: 'Create Slides', icon: <IconApps /> },
  { text: 'Research Skills', icon: <IconSearch /> },
] as const

export default function UserPrototypePage() {
  const [activeMenu, setActiveMenu] = useState<SideMenu>('new')
  const [activeSessionId, setActiveSessionId] = useState(sessionsSeed[0].id)
  const [accountMenuVisible, setAccountMenuVisible] = useState(false)

  const activeSession = useMemo(
    () => sessionsSeed.find((session) => session.id === activeSessionId) ?? sessionsSeed[0],
    [activeSessionId],
  )

  return (
    <div className="user-prototype-root">
      <Layout className="desktop-shell">
        <Layout.Sider className="desktop-sidebar">
          <div className="brand-row">
            <Avatar color="grey" size="small">
              F
            </Avatar>
            <Typography.Title heading={4} className="brand-name">
              OpenFoal
            </Typography.Title>
            <button type="button" className="icon-plain-btn" aria-label="toggle sidebar">
              <IconSidebar />
            </button>
          </div>

          <Nav
            className="side-nav"
            selectedKeys={[activeMenu]}
            onClick={(data: { itemKey?: string | number }) => {
              const key = String(data.itemKey ?? '') as SideMenu
              setActiveMenu(key)
            }}
            items={[
              { itemKey: 'new', text: 'New Desktop', icon: <IconPlusCircle /> },
              { itemKey: 'skills', text: 'Skill Store', icon: <IconPuzzle /> },
              {
                itemKey: 'automations',
                text: (
                  <span className="side-label-with-tag">
                    Automations <Tag size="small">Beta</Tag>
                  </span>
                ),
                icon: <IconBolt />,
              },
            ]}
            footer={{ collapseButton: false }}
          />

          <Typography.Text type="tertiary" className="section-title section-history">
            HISTORY
          </Typography.Text>
          <div className="session-list">
            {sessionsSeed.map((session) => (
              <button
                key={session.id}
                type="button"
                className={activeSessionId === session.id ? 'session-item active' : 'session-item'}
                onClick={() => {
                  setActiveSessionId(session.id)
                  setActiveMenu('new')
                }}
              >
                <Typography.Text className="session-title">{session.title}</Typography.Text>
                <Typography.Text type="tertiary" className="session-preview">
                  {session.preview}
                </Typography.Text>
                <Space spacing={4} className="session-meta">
                  <Tag size="small" color={session.runtimeMode === 'local' ? 'cyan' : 'purple'}>
                    {session.runtimeMode}
                  </Tag>
                  <Tag size="small" color={session.syncState === 'synced' ? 'green' : 'orange'}>
                    {session.syncState}
                  </Tag>
                </Space>
              </button>
            ))}
          </div>

          <div className="sidebar-footer">
            <div className="sandbox-box">
              <Typography.Text type="secondary">Sandbox</Typography.Text>
              <Space spacing={6}>
                <span className="dot-green" />
                <Typography.Text type="secondary">Running</Typography.Text>
              </Space>
              <Typography.Text type="tertiary">27 containers · 9 active</Typography.Text>
            </div>
          </div>

          <div className="user-box">
            <Dropdown
              position="topLeft"
              trigger="click"
              spacing={10}
              showArrow={false}
              visible={accountMenuVisible}
              onVisibleChange={setAccountMenuVisible}
              contentClassName="account-dropdown-wrap"
              render={
                <div className="account-dropdown-panel">
                  <div className="account-dropdown-head">
                    <Avatar color="orange" size="default">
                      啵鸣
                    </Avatar>
                    <div>
                      <Typography.Text className="account-dropdown-name">啵鸣喵</Typography.Text>
                      <Typography.Text type="tertiary" className="account-dropdown-email">
                        openfoal@example.com
                      </Typography.Text>
                    </div>
                  </div>
                  <Divider margin="10px 0 8px" />
                  <Dropdown.Menu className="account-dropdown-menu">
                    <Dropdown.Item icon={<IconSettingStroked />}>Settings</Dropdown.Item>
                    <Dropdown.Item icon={<IconCommentStroked />}>Community</Dropdown.Item>
                    <Dropdown.Item icon={<IconMailStroked />}>Contact Us</Dropdown.Item>
                    <Dropdown.Item icon={<IconPhoneStroked />}>iOS App</Dropdown.Item>
                    <Dropdown.Divider />
                    <Dropdown.Item icon={<IconExit />} type="danger">
                      Sign Out
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </div>
              }
            >
              <button type="button" className="user-trigger-card" aria-label="settings">
                <Avatar color="orange" size="small">
                  啵鸣
                </Avatar>
                <div className="user-trigger-copy">
                  <Typography.Text className="user-trigger-name">啵鸣喵</Typography.Text>
                  <Typography.Text type="tertiary" className="user-trigger-plan">
                    openfoal@example.com
                  </Typography.Text>
                </div>
                {accountMenuVisible ? (
                  <IconChevronUp className="muted-icon" />
                ) : (
                  <IconChevronDown className="muted-icon" />
                )}
              </button>
            </Dropdown>
          </div>
        </Layout.Sider>

        <Layout.Content className="desktop-main-wrap">
          {activeMenu === 'skills' ? <SkillStorePanel /> : null}
          {activeMenu === 'automations' ? <AutomationPanel /> : null}
          {activeMenu === 'new' ? <ChatPanel sessionTitle={activeSession.title} /> : null}
        </Layout.Content>
      </Layout>
    </div>
  )
}

function ChatPanel({ sessionTitle }: { sessionTitle: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const messageSequenceRef = useRef(0)

  const handleSend = (quickText?: string) => {
    const text = (quickText ?? inputValue).trim()
    if (!text) {
      return
    }

    const id = `msg-${messageSequenceRef.current}`
    messageSequenceRef.current += 1
    setMessages((prev) => [
      ...prev,
      { id: `${id}-u`, role: 'user', text },
      {
        id: `${id}-a`,
        role: 'assistant',
        text: `收到：${text}。这是用户端原型环境中的静态回显。`,
      },
    ])
    setInputValue('')
  }

  return (
    <Card className="workspace-panel workspace-panel-chat" bodyStyle={{ padding: 0 }}>
      <div className="workspace-header chat-top-header">
        <Space spacing={8} align="center">
          <Typography.Title heading={3} className="workspace-title">
            {sessionTitle}
          </Typography.Title>
          <Typography.Text type="tertiary" className="chat-runtime-model-pill">
            Runtime Model Used: OpenAI / gpt-5
          </Typography.Text>
        </Space>
        <Button icon={<IconShareStroked />} theme="light" type="primary">
          Share
        </Button>
      </div>

      <div className="tab-strip">
        <button type="button" className="strip-tab active">
          <IconLightningStroked /> Session
        </button>
        <button type="button" className="strip-tab add-tab">
          +
        </button>
      </div>

      <div className="workspace-body">
        <div className="chat-feed">
          {messages.length === 0 ? (
            <>
              <div className="feature-grid">
                {featureCards.map((item) => (
                  <Card key={item.title} className={`feature-card ${item.tone}`} bodyStyle={{ padding: 0 }}>
                    <div className="feature-head">
                      <Space>
                        {item.icon}
                        <Typography.Title heading={5}>{item.title}</Typography.Title>
                      </Space>
                      <Typography.Text type="tertiary">{item.desc}</Typography.Text>
                    </div>
                    <div className="feature-art" />
                  </Card>
                ))}
              </div>
              <Typography.Text type="tertiary">Start a conversation to explore your workspace.</Typography.Text>
            </>
          ) : (
            <div className="message-list">
              {messages.map((message) => (
                <div key={message.id} className={`message-row ${message.role}`}>
                  <Typography.Text className="message-role">{message.role.toUpperCase()}</Typography.Text>
                  <div className="message-text">{message.text}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="quick-start">
          <Typography.Title heading={4}>Quick Start</Typography.Title>
          <div className="chips">
            {quickActions.map((action) => (
              <Button
                key={action.text}
                icon={action.icon}
                theme="light"
                type="tertiary"
                className="action-chip"
                onClick={() => handleSend(action.text)}
              >
                {action.text}
              </Button>
            ))}
          </div>
        </div>

        <div className="composer-wrap">
          <Input
            className="composer-input"
            value={inputValue}
            onChange={(value) => setInputValue(value)}
            onEnterPress={() => handleSend()}
            placeholder="Ask anything..."
            suffix={
              <div className="composer-actions">
                <Button
                  icon={<IconArrowUp />}
                  theme="solid"
                  type="primary"
                  circle
                  className="composer-send-btn"
                  onClick={() => handleSend()}
                />
              </div>
            }
          />
          <div className="composer-footer">
            <div className="composer-left-actions">
              <Button theme="borderless" icon={<IconPlusCircle />}>
                Add
              </Button>
              <Button theme="borderless" icon={<IconPuzzle />}>
                Skills
              </Button>
            </div>
            <Typography.Text type="secondary">Ready</Typography.Text>
          </div>
        </div>
      </div>
    </Card>
  )
}

function SkillStorePanel() {
  const [tab, setTab] = useState<StoreTab>('featured')
  const [installedIds, setInstalledIds] = useState<string[]>([
    'skill-design-review',
    'skill-doc-assistant',
  ])

  const rows = useMemo(() => {
    if (tab === 'installed') {
      return skillCatalogSeed.filter((item) => installedIds.includes(item.id))
    }
    if (tab === 'featured') {
      return skillCatalogSeed.slice(0, 4)
    }
    return skillCatalogSeed
  }, [installedIds, tab])

  const left = rows.filter((_, idx) => idx % 2 === 0)
  const right = rows.filter((_, idx) => idx % 2 === 1)

  const toggleInstall = (skillId: string) => {
    setInstalledIds((prev) =>
      prev.includes(skillId) ? prev.filter((id) => id !== skillId) : [...prev, skillId],
    )
  }

  return (
    <Card className="workspace-panel" bodyStyle={{ padding: 0 }}>
      <div className="skill-store-body">
        <section className="skill-hero">
          <div className="skill-hero-overlay">
            <Typography.Text className="hero-tag">GET STARTED</Typography.Text>
            <Typography.Title heading={1} className="hero-title">
              Introducing Skill Store
            </Typography.Title>
            <Typography.Text className="hero-subtitle">
              Browse reusable abilities for your user workflows.
            </Typography.Text>
            <button type="button" className="hero-link" aria-label="open">
              <IconArrowRight />
            </button>
          </div>
        </section>

        <section className="recommend-grid">
          {recommendationCards.map((item) => (
            <article key={item.title} className="recommend-card">
              <div>
                <Typography.Text type="tertiary" className="recommend-label">
                  {item.label}
                </Typography.Text>
                <Typography.Title heading={3} className="recommend-title">
                  {item.title}
                </Typography.Title>
                <Typography.Text type="secondary" className="recommend-desc">
                  {item.desc}
                </Typography.Text>
              </div>
              <div className={`recommend-cover ${item.tone}`} />
            </article>
          ))}
        </section>

        <section className="skill-tabs">
          <button
            type="button"
            className={tab === 'featured' ? 'store-tab active' : 'store-tab'}
            onClick={() => setTab('featured')}
          >
            Featured <span className="tab-badge">{skillCatalogSeed.slice(0, 4).length}</span>
          </button>
          <button
            type="button"
            className={tab === 'explore' ? 'store-tab active' : 'store-tab'}
            onClick={() => setTab('explore')}
          >
            Explore <span className="tab-badge">{skillCatalogSeed.length}</span>
          </button>
          <button
            type="button"
            className={tab === 'installed' ? 'store-tab active' : 'store-tab'}
            onClick={() => setTab('installed')}
          >
            Installed <span className="tab-badge">{installedIds.length}</span>
          </button>
        </section>

        {rows.length === 0 ? (
          <div className="settings-placeholder" style={{ marginTop: 12 }}>
            No installed skills yet.
          </div>
        ) : (
          <section className="skill-list-grid">
            <div>
              {left.map((item) => (
                <SkillRow
                  key={item.id}
                  item={item}
                  installed={installedIds.includes(item.id)}
                  onToggleInstall={toggleInstall}
                />
              ))}
            </div>
            <div>
              {right.map((item) => (
                <SkillRow
                  key={item.id}
                  item={item}
                  installed={installedIds.includes(item.id)}
                  onToggleInstall={toggleInstall}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </Card>
  )
}

function SkillRow({
  item,
  installed,
  onToggleInstall,
}: {
  item: SkillItem
  installed: boolean
  onToggleInstall: (skillId: string) => void
}) {
  return (
    <div className="skill-row">
      <div className="skill-brand">{item.brand}</div>
      <div className="skill-copy">
        <Typography.Text className="skill-title">{item.title}</Typography.Text>
        <Typography.Text type="tertiary">{item.desc}</Typography.Text>
        <Typography.Text type="tertiary">{item.invocation}</Typography.Text>
      </div>
      <button
        type="button"
        className="add-skill-btn"
        aria-label={installed ? 'uninstall skill' : 'install skill'}
        onClick={() => onToggleInstall(item.id)}
      >
        {installed ? <IconClose /> : <IconPlus />}
      </button>
    </div>
  )
}

function AutomationPanel() {
  return (
    <Card className="workspace-panel" bodyStyle={{ padding: 24 }}>
      <div className="settings-placeholder" style={{ minHeight: 320 }}>
        Automations（Beta）正在准备中。
      </div>
      <Space style={{ marginTop: 16 }}>
        <Button icon={<IconDesktop />}>新建自动化</Button>
        <Button theme="light" type="tertiary">
          查看运行日志
        </Button>
      </Space>
    </Card>
  )
}
