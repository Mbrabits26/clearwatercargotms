import * as React from 'react'
import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text } from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  audience?: 'carrier' | 'broker'
  rc?: string
  lane?: string
  carrier?: string
  total?: string
  signerName?: string
  signerTitle?: string
  signedAt?: string
  downloadUrl?: string
  loadUrl?: string
}

const Email = ({ audience = 'carrier', rc = '', lane, carrier, total, signerName, signerTitle, signedAt, downloadUrl, loadUrl }: Props) => {
  const broker = audience === 'broker'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{broker ? `${carrier ?? 'Carrier'} signed RC #${rc}` : `Your signed rate confirmation RC #${rc}`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={band}><Text style={brand}>CLEARWATER CARGO</Text></Section>
          <Heading style={h1}>{broker ? `Rate con signed — RC #${rc}` : `Signed rate confirmation — RC #${rc}`}</Heading>
          <Text style={text}>
            {broker
              ? `${carrier ?? 'The carrier'} has signed the rate confirmation for this load.`
              : 'Thank you for signing. Your signed copy is ready to download any time from the link below.'}
          </Text>
          <Section style={box}>
            {lane ? <Text style={row}><b>Lane:</b> {lane}</Text> : null}
            {carrier ? <Text style={row}><b>Carrier:</b> {carrier}</Text> : null}
            {total ? <Text style={row}><b>Total to carrier:</b> {total}</Text> : null}
            <Text style={row}><b>Signed by:</b> {signerName ?? '—'}{signerTitle ? `, ${signerTitle}` : ''}</Text>
            {signedAt ? <Text style={row}><b>Signed:</b> {signedAt}</Text> : null}
          </Section>
          {downloadUrl ? <Button style={button} href={downloadUrl}>Download signed copy</Button> : null}
          {broker && loadUrl ? <Text style={text}><a href={loadUrl} style={link}>Open the load in the TMS</a></Text> : null}
          <Hr style={hr} />
          <Text style={footer}>Clearwater Cargo LLC · Staley, NC · 252-497-7916</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: Email,
  subject: (d: Record<string, any>) =>
    d.audience === 'broker' ? `Signed: RC #${d.rc ?? ''} — ${d.carrier ?? 'carrier'}` : `Your signed rate confirmation — RC #${d.rc ?? ''}`,
  displayName: 'Rate con signed',
  previewData: { audience: 'carrier', rc: '10452', lane: 'Raleigh, NC → Atlanta, GA', carrier: 'Acme Trucking', total: '$2,300.00', signerName: 'Jane Smith', signerTitle: 'Dispatcher', signedAt: 'Oct 22, 2026 4:30 PM', downloadUrl: 'https://tms.clearwatercargo.com' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '0 0 20px', maxWidth: '560px' }
const band = { backgroundColor: '#0b3b3c', padding: '14px 24px' }
const brand = { color: '#d4a537', fontSize: '18px', fontWeight: 700, letterSpacing: '2px', margin: 0 }
const h1 = { fontSize: '22px', color: '#111111', padding: '0 24px', margin: '20px 0 8px' }
const text = { fontSize: '14px', color: '#333333', padding: '0 24px', lineHeight: '22px' }
const box = { margin: '8px 24px 16px', padding: '12px 16px', border: '1px solid #e5e5e5', borderRadius: '6px' }
const row = { fontSize: '14px', color: '#333333', margin: '4px 0' }
const button = { backgroundColor: '#d4a537', color: '#111111', padding: '12px 20px', borderRadius: '6px', fontWeight: 700, fontSize: '14px', marginLeft: '24px' }
const link = { color: '#0b6b6d' }
const hr = { borderColor: '#e5e5e5', margin: '24px' }
const footer = { fontSize: '12px', color: '#888888', padding: '0 24px' }
