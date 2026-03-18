import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Issue } from '../types'

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
}

const SEV_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  Urgent:     { bg: '#ef444422', color: '#ef4444', border: '#ef444444' },
  Concerning: { bg: '#f59e0b22', color: '#f59e0b', border: '#f59e0b44' },
  Monitoring: { bg: '#3b82f622', color: '#3b82f6', border: '#3b82f644' },
}

function IssueCard({ issue }: { issue: Issue }) {
  const sev = SEV_STYLE[issue.severity || ''] || { bg: '#5a648022', color: '#5a6480', border: '#5a648044' }
  const resolved = issue.status === 'Resolved'
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '1rem 1.25rem', opacity: resolved ? 0.55 : 1 }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ background: sev.bg, color: sev.color, border: `1px solid ${sev.border}`, borderRadius: 4, padding: '2px 8px', fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {issue.severity}
        </span>
        {issue.frequency && (
          <span style={{ color: 'var(--sub)', fontSize: '0.73rem', background: 'var(--bg3)', borderRadius: 4, padding: '2px 8px' }}>{issue.frequency}</span>
        )}
        <span style={{ marginLeft: 'auto', color: 'var(--sub)', fontSize: '0.73rem' }}>{fmtDate(issue.date)}</span>
        {issue.odometer_km && (
          <span style={{ color: 'var(--sub)', fontSize: '0.73rem', fontFamily: 'DM Mono, monospace' }}>{issue.odometer_km.toLocaleString()} km</span>
        )}
      </div>
      <div style={{ fontSize: '0.875rem', lineHeight: 1.5 }}>{issue.description}</div>
      {issue.notes && <div style={{ color: 'var(--sub)', fontSize: '0.78rem', marginTop: 4, fontStyle: 'italic' }}>{issue.notes}</div>}
      {issue.resolved_date && (
        <div style={{ color: 'var(--green)', fontSize: '0.73rem', marginTop: 6 }}>✓ Resolved {fmtDate(issue.resolved_date)}</div>
      )}
    </div>
  )
}

interface Props { vehicleId: string }

export default function Issues({ vehicleId }: Props) {
  const [issues, setIssues] = useState<Issue[]>([])

  useEffect(() => {
    supabase.from('issues').select('*').eq('vehicle_id', vehicleId).order('date', { ascending: false }).then(({ data }) => {
      if (data) setIssues(data)
    })
  }, [vehicleId])

  const open = issues.filter(i => i.status === 'Open')
  const resolved = issues.filter(i => i.status === 'Resolved')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <div style={{ fontWeight: 600, marginBottom: '0.75rem' }}>
          Open Issues <span style={{ color: 'var(--sub)', fontWeight: 400 }}>({open.length})</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {open.length === 0 && <div style={{ color: 'var(--sub)', fontSize: '0.875rem' }}>No open issues — nice!</div>}
          {open.map(i => <IssueCard key={i.id} issue={i} />)}
        </div>
      </div>

      {resolved.length > 0 && (
        <div>
          <div style={{ fontWeight: 600, color: 'var(--sub)', marginBottom: '0.75rem' }}>
            Resolved <span style={{ fontWeight: 400 }}>({resolved.length})</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {resolved.map(i => <IssueCard key={i.id} issue={i} />)}
          </div>
        </div>
      )}
    </div>
  )
}
