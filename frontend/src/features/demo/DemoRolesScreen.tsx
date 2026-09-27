import { bootstrap } from '../../app/bootstrap'
import { useApp } from '../../app/store'
import { STORAGE_KEYS, local } from '../../platform/storage'
import { DemoAccess, useDemoConfig } from './DemoAccess'

const leaveDemo = () => {
  local.remove(STORAGE_KEYS.demo)
  local.remove(STORAGE_KEYS.webSession)
  useApp.getState().patch({ stack: [] })
  useApp.getState().go('loading')
  void bootstrap({ skipDemoEntry: true })
}

/** Вход в демо-академию из мини-приложения и сайта: выбор роли для жюри. */
export function DemoRolesScreen() {
  const config = useDemoConfig()
  return (
    <div className="scr fi" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 28, minHeight: '100%' }}>
      <div style={{ textAlign: 'center', maxWidth: 340, width: '100%' }}>
        <img
          src="/academy-role-logo.jpg"
          alt="MADCAP Academy"
          width="112"
          height="112"
          style={{ width: 112, height: 112, margin: '0 auto 16px', borderRadius: '50%', objectFit: 'cover', display: 'block', boxShadow: '0 0 30px rgba(201,162,39,.3)' }}
        />
        <h1 style={{ fontSize: 22, margin: '0 0 10px', color: 'var(--gold)' }}>Демо-академия</h1>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, lineHeight: 1.55, color: 'var(--dim)', margin: '0 0 18px' }}>
          Выберите роль. Внутри будет кнопка «Демо»: она создаёт новые работы, заявки и сообщения в реальном времени, а «Сменить роль» вернёт сюда.
        </p>
        {config.isSuccess && !config.data.enabled ? (
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--danger)' }}>Демо-режим на сервере выключен.</p>
        ) : (
          <DemoAccess framed={false} />
        )}
        <button type="button" className="btn" style={{ marginTop: 16 }} onClick={leaveDemo}>
          Выйти из демо
        </button>
      </div>
    </div>
  )
}
