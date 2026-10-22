import * as React from 'react'
import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text } from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  loadNumber?: string
  lane?: string
  driver?: string
  what?: string
  note?: string
  place?: string
  at?: string
  loadUrl?: string
}

const Email = ({ loadNumber = '', lane, driver, what = 'Update', note, place, at, loadUrl }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`Load ${loadNumber}: ${what}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={band}><Text style={brand}>CLEARWATER CARGO</Text></Section>
        <Heading style={h1}>{`Driver update — Load ${loadNumber}`}</Heading>
        <Section style={box}>
          <Text style={row}><b>Update:</b> {what}</Text>
          {driver ? <Text style={row}><b>Driver:</b> {driver}</Text> : null}
          {lane ? <Text style={row}><b>Lane:</b> {lane}</Text> : null}
          {place ? <Text style={row}><b>Location:</b> {place}</Text> : null}
          {note ? <Text style={row}><b>Note:</b> {note}</Text> : null}
          {at ? <Text style={row}><b>Time:</b> {at}</Text> : null}
        </Section>
        {loadUrl ? <Button style={button} href={loadUrl}>Open dispatch board</Button> : null}
        <Hr style={hr} />
        <Text style={footer}>Change which alerts you get from the bell icon → Alert settings in the TMS.</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => `Load ${d.loadNumber ?? ''}: ${d.what ?? 'Driver update'}`,
  displayName: 'Driver tracking update',
  previewData: { loadNumber: '10452', lane: 'Raleigh, NC → Atlanta, GA', driver: 'John', what: 'Status: Arrived at pickup', place: 'Raleigh, NC', at: 'Oct 22, 2026 4:30 PM ET', loadUrl: 'https://tms.clearwatercargo.com/dispatch' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '0 0 20px', maxWidth: '560px' }
const band = { backgroundColor: '#0b3b3c', padding: '14px 24px' }
const brand = { color: '#d4a537', fontSize: '18px', fontWeight: 700, letterSpacing: '2px', margin: 0 }
const h1 = { fontSize: '22px', color: '#111111', padding: '0 24px', margin: '20px 0 8px' }
const box = { margin: '8px 24px 16px', padding: '12px 16px', border: '1px solid #e5e5e5', borderRadius: '6px' }
const row = { fontSize: '14px', color: '#333333', margin: '4px 0' }
const button = { backgroundColor: '#d4a537', color: '#111111', padding: '12px 20px', borderRadius: '6px', fontWeight: 700, fontSize: '14px', marginLeft: '24px' }
const hr = { borderColor: '#e5e5e5', margin: '24px' }
const footer = { fontSize: '12px', color: '#888888', padding: '0 24px' }
