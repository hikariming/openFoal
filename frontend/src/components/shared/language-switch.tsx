import { Select } from '@douyinfe/semi-ui'
import { useTranslation } from 'react-i18next'
import { normalizeLanguage, type AppLanguage } from '@/i18n'

export function LanguageSwitch() {
  const { t, i18n } = useTranslation()
  const activeLanguage = normalizeLanguage(i18n.resolvedLanguage)

  return (
    <Select
      size="small"
      insetLabel={t('common.language')}
      value={activeLanguage}
      style={{ width: 170 }}
      optionList={[
        { value: 'zh-CN', label: t('common.languages.zhCN') },
        { value: 'en-US', label: t('common.languages.enUS') },
      ]}
      onChange={(value) => {
        void i18n.changeLanguage(value as AppLanguage)
      }}
    />
  )
}
