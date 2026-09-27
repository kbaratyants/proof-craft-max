/** Подпись «кто переписывается»: ученик, его преподаватели и администрация академии. */
export function ChatParticipants({ student, teachers }: { student?: string | null; teachers?: string[] | null }) {
  const parts = [
    student ? `${student} (ученик)` : null,
    teachers?.length ? `${teachers.join(', ')} (${teachers.length > 1 ? 'преподаватели' : 'преподаватель'})` : 'преподаватель не назначен',
    'администрация',
  ].filter(Boolean)
  return (
    <div
      style={{
        padding: '8px 14px',
        borderBottom: '1px solid var(--border)',
        fontFamily: 'var(--font-body)',
        fontSize: 12,
        lineHeight: 1.45,
        color: 'var(--dim)',
      }}
    >
      <span style={{ fontWeight: 700, color: 'var(--text)' }}>Участники: </span>
      {parts.join(' · ')}
    </div>
  )
}
