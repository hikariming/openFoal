import { Card, Typography } from "@douyinfe/semi-ui";
import { IconArrowRight, IconPlus } from "@douyinfe/semi-icons";
import { useTranslation } from "react-i18next";

const recommendationCards = [
  {
    labelKey: "skillStore.promptsWeLove",
    title: "Moltbook Where AI\\nAgents Gather",
    desc: 'Agents join a "Reddit" forum.',
    tone: "moltbook"
  },
  {
    labelKey: "skillStore.skillsWeLove",
    title: "Slides as a Web\\nExperience",
    desc: "Design slides like a living interface.",
    tone: "slides"
  },
  {
    labelKey: "skillStore.skillsWeLove",
    title: "The Committee\\nTechnique",
    desc: "Seven experts stress-test your AI outputs.",
    tone: "committee"
  }
] as const;

const leftColumnSkills = [
  {
    title: "Better Auth Best Practices",
    desc: "TypeScript authentication framework integration guide",
    brand: "H"
  },
  {
    title: "Building Native UI",
    desc: "Complete guide for building apps with Expo Router",
    brand: "A"
  },
  {
    title: "OpenFoal Skill Creator",
    desc: "Scaffold practical skills with clear output contracts",
    brand: "C"
  }
] as const;

const rightColumnSkills = [
  {
    title: "Image Enhancer",
    desc: "Enhance image quality and resolution",
    brand: "E"
  },
  {
    title: "Create Design System Rules",
    desc: "Generate custom design system rules for Figma workflows",
    brand: "F"
  },
  {
    title: "Supabase Postgres Best Practices",
    desc: "Database reliability checklist and SQL patterns",
    brand: "S"
  }
] as const;

export function SkillStoreView() {
  const { t } = useTranslation();

  return (
    <Card className="workspace-panel skill-store-panel" bodyStyle={{ padding: 0 }}>
      <div className="skill-store-body">
        <section className="skill-hero">
          <div className="skill-hero-overlay">
            <Typography.Text className="hero-tag">{t("skillStore.getStarted")}</Typography.Text>
            <Typography.Title heading={1} className="hero-title">
              {t("skillStore.introducing")}
            </Typography.Title>
            <Typography.Text className="hero-subtitle">{t("skillStore.subtitle")}</Typography.Text>
            <button type="button" className="hero-link">
              <IconArrowRight />
            </button>
          </div>
        </section>

        <section className="recommend-grid">
          {recommendationCards.map((item) => (
            <article key={item.title} className="recommend-card">
              <div>
                <Typography.Text type="tertiary" className="recommend-label">
                  {t(item.labelKey)}
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
          <button type="button" className="store-tab active">
            {t("common.featured")}
          </button>
          <button type="button" className="store-tab">
            {t("common.explore")} <span className="tab-badge">196,694</span>
          </button>
          <button type="button" className="store-tab">
            {t("common.installed")} <span className="tab-badge">14</span>
          </button>
        </section>

        <section className="skill-list-grid">
          <div>
            {leftColumnSkills.map((item) => (
              <div key={item.title} className="skill-row">
                <div className="skill-brand">{item.brand}</div>
                <div className="skill-copy">
                  <Typography.Text className="skill-title">{item.title}</Typography.Text>
                  <Typography.Text type="tertiary">{item.desc}</Typography.Text>
                </div>
                <button type="button" className="add-skill-btn" aria-label={`add ${item.title}`}>
                  <IconPlus />
                </button>
              </div>
            ))}
          </div>

          <div>
            {rightColumnSkills.map((item) => (
              <div key={item.title} className="skill-row">
                <div className="skill-brand">{item.brand}</div>
                <div className="skill-copy">
                  <Typography.Text className="skill-title">{item.title}</Typography.Text>
                  <Typography.Text type="tertiary">{item.desc}</Typography.Text>
                </div>
                <button type="button" className="add-skill-btn" aria-label={`add ${item.title}`}>
                  <IconPlus />
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Card>
  );
}
