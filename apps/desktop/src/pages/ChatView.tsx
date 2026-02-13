import { Button, Card, Input, Space, Typography } from "@douyinfe/semi-ui";
import {
  IconApps,
  IconArrowUp,
  IconArticle,
  IconCopy,
  IconImage,
  IconLikeHeart,
  IconLightningStroked,
  IconPlusCircle,
  IconPuzzle,
  IconSearch,
  IconShareStroked,
  IconUserGroup
} from "@douyinfe/semi-icons";
import { useTranslation } from "react-i18next";

export function ChatView({ sessionTitle }: { sessionTitle: string }) {
  const { t } = useTranslation();

  const chatCards = [
    {
      title: t("chat.skillsTitle"),
      desc: t("chat.skillsDesc"),
      tone: "skills",
      icon: <IconPuzzle />
    },
    {
      title: t("chat.automationsTitle"),
      desc: t("chat.automationsDesc"),
      tone: "automations",
      icon: <IconLightningStroked />
    },
    {
      title: t("chat.teamsTitle"),
      desc: t("chat.teamsDesc"),
      tone: "teams",
      icon: <IconUserGroup />
    }
  ] as const;

  const quickActions = [
    { text: t("quickActions.joinMoltbook"), icon: <IconLikeHeart /> },
    { text: t("quickActions.createSkill"), icon: <IconPuzzle /> },
    { text: t("quickActions.nanoBanana"), icon: <IconImage /> },
    { text: t("quickActions.createSlides"), icon: <IconArticle /> },
    { text: t("quickActions.frontendDesign"), icon: <IconApps /> },
    { text: t("quickActions.copymailSkill"), icon: <IconCopy /> },
    { text: t("quickActions.researchSkills"), icon: <IconSearch /> }
  ] as const;

  return (
    <Card className="workspace-panel" bodyStyle={{ padding: 0 }}>
      <div className="workspace-header chat-top-header">
        <Space>
          <Typography.Title heading={3} className="workspace-title">
            {sessionTitle}
          </Typography.Title>
        </Space>
        <Button icon={<IconShareStroked />} theme="light" type="primary">
          {t("chat.share")}
        </Button>
      </div>

      <div className="tab-strip">
        <button type="button" className="strip-tab active">
          <IconLightningStroked /> {t("chat.session")}
        </button>
        <button type="button" className="strip-tab add-tab">
          +
        </button>
      </div>

      <div className="workspace-body">
        <div className="feature-grid">
          {chatCards.map((item) => (
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

        <div className="quick-start">
          <Typography.Title heading={4}>{t("chat.quickStartTitle")}</Typography.Title>
          <div className="chips">
            {quickActions.map((action) => (
              <Button key={action.text} icon={action.icon} theme="light" type="tertiary" className="action-chip">
                {action.text}
              </Button>
            ))}
          </div>
        </div>

        <div className="composer-wrap">
          <Input
            className="composer-input"
            placeholder={t("chat.askPlaceholder")}
            suffix={
              <div className="composer-actions">
                <Button
                  icon={<IconArrowUp />}
                  theme="solid"
                  type="primary"
                  circle
                  className="composer-send-btn"
                />
              </div>
            }
          />
          <div className="composer-footer">
            <div className="composer-left-actions">
              <Button theme="borderless" icon={<IconPlusCircle />}>
                {t("chat.add")}
              </Button>
              <Button theme="borderless" icon={<IconPuzzle />}>
                {t("chat.skills")}
              </Button>
            </div>
            <Typography.Text type="secondary">Sonnet 4.5</Typography.Text>
          </div>
        </div>
      </div>
    </Card>
  );
}
