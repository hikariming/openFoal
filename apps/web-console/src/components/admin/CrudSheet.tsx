import { Button, Form, SideSheet, Space } from "@douyinfe/semi-ui";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export type CrudSheetMode = "create" | "edit";

type CrudSheetProps<T extends Record<string, unknown>> = {
  visible: boolean;
  title: string;
  mode: CrudSheetMode;
  width?: number;
  loading?: boolean;
  initValues: T;
  onCancel: () => void;
  onSubmit: (values: T) => void | Promise<void>;
  children: ReactNode | ((formApi: any) => ReactNode);
};

export function CrudSheet<T extends Record<string, unknown>>(props: CrudSheetProps<T>): JSX.Element {
  const { t } = useTranslation();
  const [formApi, setFormApi] = useState<any>(null);

  useEffect(() => {
    if (!props.visible || !formApi || typeof formApi.setValues !== "function") {
      return;
    }
    formApi.setValues(props.initValues);
  }, [formApi, props.initValues, props.visible]);

  return (
    <SideSheet
      visible={props.visible}
      title={props.title}
      width={props.width ?? 520}
      onCancel={props.onCancel}
      footer={
        <Space>
          <Button theme="light" onClick={props.onCancel}>
            {t("common.cancel")}
          </Button>
          <Button theme="solid" loading={props.loading} onClick={() => formApi?.submitForm?.()}>
            {props.mode === "create" ? t("common.create") : t("common.save")}
          </Button>
        </Space>
      }
    >
      <Form initValues={props.initValues} getFormApi={setFormApi} onSubmit={(values) => void props.onSubmit(values as T)} labelPosition="top">
        {typeof props.children === "function" ? props.children(formApi) : props.children}
      </Form>
    </SideSheet>
  );
}
