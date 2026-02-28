import { Card, Typography } from "@douyinfe/semi-ui";
import { IconArrowRight, IconClose, IconPlus } from "@douyinfe/semi-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getGatewayClient, type GatewayInstalledSkill, type GatewaySkillCatalogItem } from "../lib/gateway-client";

const recommendationCards = [
  {
    labelKey: "skillStore.promptsWeLove",
    title: "Moltbook Where AI\nAgents Gather",
    desc: 'Agents join a "Reddit" forum.',
    tone: "moltbook"
  },
  {
    labelKey: "skillStore.skillsWeLove",
    title: "Slides as a Web\nExperience",
    desc: "Design slides like a living interface.",
    tone: "slides"
  },
  {
    labelKey: "skillStore.skillsWeLove",
    title: "The Committee\nTechnique",
    desc: "Seven experts stress-test your AI outputs.",
    tone: "committee"
  }
] as const;

type StoreTab = "featured" | "explore" | "installed";

type SkillRow = {
  skillId: string;
  title: string;
  desc: string;
  brand: string;
  invocation: string;
  source?: string;
  tags: string[];
  installed: boolean;
  installedAt?: string;
};

export function SkillStoreView() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<StoreTab>("featured");
  const [catalog, setCatalog] = useState<GatewaySkillCatalogItem[]>([]);
  const [installed, setInstalled] = useState<GatewayInstalledSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingSkillId, setPendingSkillId] = useState<string | undefined>(undefined);

  const loadData = useCallback(
    async (tryRefreshWhenEmpty = true) => {
      setLoading(true);
      setError("");
      setNotice("");
      try {
        const client = getGatewayClient();
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        let [catalogResult, installedResult] = await Promise.all([
          client.listSkillCatalog({
            scope: "user",
            timezone
          }),
          client.listInstalledSkills({
            scope: "user"
          })
        ]);

        if (tryRefreshWhenEmpty && catalogResult.items.length === 0) {
          await client.refreshSkillCatalog({
            scope: "user",
            timezone
          });
          [catalogResult, installedResult] = await Promise.all([
            client.listSkillCatalog({
              scope: "user",
              timezone
            }),
            client.listInstalledSkills({
              scope: "user"
            })
          ]);
        }

        setCatalog(catalogResult.items);
        setInstalled(installedResult);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadData(true);
  }, [loadData]);

  const installedSet = useMemo(() => {
    return new Set(installed.map((item) => item.skillId));
  }, [installed]);

  const catalogRows = useMemo<SkillRow[]>(() => {
    return catalog.map((item) => ({
      skillId: item.skillId,
      title: formatSkillTitle(item.skillId),
      desc: buildSkillDesc(item.source, item.tags),
      brand: makeSkillBrand(item.skillId),
      invocation: `/skill:${item.skillId}`,
      source: item.source,
      tags: item.tags,
      installed: installedSet.has(item.skillId)
    }));
  }, [catalog, installedSet]);

  const installedRows = useMemo<SkillRow[]>(() => {
    return installed.map((item) => ({
      skillId: item.skillId,
      title: formatSkillTitle(item.skillId),
      desc: buildSkillDesc(item.source, item.tags),
      brand: makeSkillBrand(item.skillId),
      invocation: item.invocation ?? `/skill:${item.skillId}`,
      source: item.source,
      tags: item.tags,
      installed: true,
      installedAt: item.installedAt
    }));
  }, [installed]);

  const featuredRows = useMemo(() => catalogRows.slice(0, 6), [catalogRows]);

  const visibleRows = useMemo(() => {
    if (tab === "installed") {
      return installedRows;
    }
    if (tab === "explore") {
      return catalogRows;
    }
    return featuredRows;
  }, [catalogRows, featuredRows, installedRows, tab]);

  const [leftColumnRows, rightColumnRows] = useMemo(() => splitByTwoColumns(visibleRows), [visibleRows]);

  const onInstall = useCallback(
    async (skillId: string) => {
      setPendingSkillId(skillId);
      setError("");
      setNotice("");
      try {
        await getGatewayClient().installSkill({
          scope: "user",
          skillId
        });
        setNotice(t("skillStore.installSuccess"));
        await loadData(false);
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : String(actionError));
      } finally {
        setPendingSkillId(undefined);
      }
    },
    [loadData, t]
  );

  const onUninstall = useCallback(
    async (skillId: string) => {
      setPendingSkillId(skillId);
      setError("");
      setNotice("");
      try {
        await getGatewayClient().uninstallSkill({
          scope: "user",
          skillId
        });
        setNotice(t("skillStore.uninstallSuccess"));
        await loadData(false);
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : String(actionError));
      } finally {
        setPendingSkillId(undefined);
      }
    },
    [loadData, t]
  );

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
            <button
              type="button"
              className="hero-link"
              onClick={() => {
                void loadData(true);
              }}
              aria-label={t("skillStore.refresh")}
            >
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
          <button type="button" className={tab === "featured" ? "store-tab active" : "store-tab"} onClick={() => setTab("featured")}>
            {t("common.featured")} <span className="tab-badge">{featuredRows.length}</span>
          </button>
          <button type="button" className={tab === "explore" ? "store-tab active" : "store-tab"} onClick={() => setTab("explore")}>
            {t("common.explore")} <span className="tab-badge">{catalogRows.length}</span>
          </button>
          <button type="button" className={tab === "installed" ? "store-tab active" : "store-tab"} onClick={() => setTab("installed")}>
            {t("common.installed")} <span className="tab-badge">{installedRows.length}</span>
          </button>
        </section>

        {loading ? <Typography.Text type="tertiary">{t("skillStore.loading")}</Typography.Text> : null}
        {notice ? <Typography.Text type="success">{notice}</Typography.Text> : null}
        {error ? <Typography.Text type="danger">{error}</Typography.Text> : null}

        {visibleRows.length === 0 ? (
          <div className="settings-placeholder" style={{ marginTop: 12 }}>
            {t("skillStore.empty")}
          </div>
        ) : (
          <section className="skill-list-grid">
            <div>
              {leftColumnRows.map((item) => (
                <SkillRowItem
                  key={item.skillId}
                  item={item}
                  pending={pendingSkillId === item.skillId}
                  onInstall={onInstall}
                  onUninstall={onUninstall}
                  t={t}
                />
              ))}
            </div>

            <div>
              {rightColumnRows.map((item) => (
                <SkillRowItem
                  key={item.skillId}
                  item={item}
                  pending={pendingSkillId === item.skillId}
                  onInstall={onInstall}
                  onUninstall={onUninstall}
                  t={t}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </Card>
  );
}

type SkillRowItemProps = {
  item: SkillRow;
  pending: boolean;
  onInstall: (skillId: string) => Promise<void>;
  onUninstall: (skillId: string) => Promise<void>;
  t: (key: string) => string;
};

function SkillRowItem(props: SkillRowItemProps): JSX.Element {
  const subtitle = props.item.installedAt ? `${props.item.desc} · ${props.item.installedAt}` : props.item.desc;
  return (
    <div className="skill-row">
      <div className="skill-brand">{props.item.brand}</div>
      <div className="skill-copy">
        <Typography.Text className="skill-title">{props.item.title}</Typography.Text>
        <Typography.Text type="tertiary">{subtitle}</Typography.Text>
        <Typography.Text type="tertiary">{props.item.invocation}</Typography.Text>
      </div>
      <button
        type="button"
        className="add-skill-btn"
        aria-label={props.item.installed ? props.t("skillStore.uninstall") : props.t("skillStore.install")}
        disabled={props.pending}
        onClick={() => {
          if (props.item.installed) {
            void props.onUninstall(props.item.skillId);
          } else {
            void props.onInstall(props.item.skillId);
          }
        }}
      >
        {props.item.installed ? <IconClose /> : <IconPlus />}
      </button>
    </div>
  );
}

function splitByTwoColumns<T>(items: T[]): [T[], T[]] {
  const left: T[] = [];
  const right: T[] = [];
  items.forEach((item, index) => {
    if (index % 2 === 0) {
      left.push(item);
    } else {
      right.push(item);
    }
  });
  return [left, right];
}

function makeSkillBrand(skillId: string): string {
  const normalized = skillId.trim();
  const first = normalized.charAt(0).toUpperCase();
  return first || "S";
}

function formatSkillTitle(skillId: string): string {
  return skillId.replace(/[_.-]+/g, " ").replace(/\s+/g, " ").trim();
}

function buildSkillDesc(source: string | undefined, tags: string[]): string {
  const sourceText = source?.trim() || "source: local";
  const tagText = tags.length > 0 ? `tags: ${tags.join(",")}` : "tags: -";
  return `${sourceText} · ${tagText}`;
}
