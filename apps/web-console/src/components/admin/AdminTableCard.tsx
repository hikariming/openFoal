import { Button, Card, Pagination, Space, Table, Typography } from "@douyinfe/semi-ui";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

type AdminTableCardProps<T extends Record<string, unknown>> = {
  title: string;
  loading?: boolean;
  columns: Array<Record<string, unknown>>;
  dataSource: T[];
  rowKey?: string | ((record?: T) => string);
  toolbar?: ReactNode;
  emptyText: string;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (next: number) => void;
  onPageSizeChange: (next: number) => void;
  renderExpandedRow?: (record: T) => ReactNode;
};

export function AdminTableCard<T extends Record<string, unknown>>(props: AdminTableCardProps<T>): JSX.Element {
  const { t } = useTranslation();
  return (
    <Card title={props.title} style={{ width: "100%" }}>
      <Space vertical align="start" style={{ width: "100%" }}>
        {props.toolbar}
        <Table
          loading={props.loading}
          rowKey={props.rowKey as any}
          columns={props.columns as any}
          dataSource={props.dataSource}
          pagination={false}
          empty={<Typography.Text type="tertiary">{props.emptyText}</Typography.Text>}
          expandedRowRender={props.renderExpandedRow as any}
        />
        <div style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Typography.Text type="tertiary" size="small">
            {t("common.total")}={props.total} · page={props.page}/{props.totalPages}
          </Typography.Text>
          <Space>
            <Button size="small" theme="light" disabled={props.page <= 1} onClick={() => props.onPageChange(props.page - 1)}>
              {t("common.previous")}
            </Button>
            <Button
              size="small"
              theme="light"
              disabled={props.page >= props.totalPages}
              onClick={() => props.onPageChange(props.page + 1)}
            >
              {t("common.next")}
            </Button>
            <Pagination
              size="small"
              total={props.total}
              currentPage={props.page}
              pageSize={props.pageSize}
              showSizeChanger
              pageSizeOpts={[10, 20, 50, 100]}
              onPageChange={props.onPageChange}
              onPageSizeChange={props.onPageSizeChange}
            />
          </Space>
        </div>
      </Space>
    </Card>
  );
}
