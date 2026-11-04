import * as React from 'react'
import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text } from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  author?: string
  loadNumber?: string
  lane?: string
  note?: string
  group?: boolean
  loadUrl?: string
}

const Email = ({ author = 'A teammate', loadNumber = '', lane, note = '', group, loadUrl }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`${author} tagged ${group ? 'the team' : 'you'} on load ${loadNumber}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={band}><Text style={brand}>CLEARWATER CARGO</Text></Section>
        <Heading style={h1}>{`${author} tagged ${group ? 'the team' : 'you'} — Load ${loadNumber}`}</Heading>
        <Section style={box}>
          {lane ? <Text style={row}><b>Lane:</b> {lane}</Text> : null}
          <Text style={quote}>{note}</Text>
        </Section>
        {loadUrl ? <Button style={button} href={loadUrl}>Open the load</Button> : null}
        <Hr style={hr} />
        <Text style={footer}>Reply in the load's Team Notes in the TMS. Turn these emails off from the bell icon → Alert settings.</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => `${d.author ?? 'A teammate'} tagged ${d.group ? 'the team' : 'you'} on load ${d.loadNumber ?? ''}`,
  displayName: 'Tagged in a load note',
  previewData: { author: 'Micheal Brabits', loadNumber: 'CW-10479', lane: 'Knoxville, TN → Brighton, CO', note: '@team do we have the POD for this load?', group: true, loadUrl: 'https://tms.clearwatercargo.com/dispatch' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '0 0 20px', maxWidth: '560px' }
const band = { backgroundColor: '#0b3b3c', padding: '14px 24px' }
const brand = { color: '#d4a537', fontSize: '18px', fontWeight: 700, letterSpacing: '2px', margin: 0 }
const h1 = { fontSize: '22px', color: '#111111', padding: '0 24px', margin: '20px 0 8px' }
const box = { margin: '8px 24px 16px', padding: '12px 16px', border: '1px solid #e5e5e5', borderRadius: '6px' }
const row = { fontSize: '14px', color: '#333333', margin: '4px 0' }
const quote = { fontSize: '15px', color: '#111111', margin: '8px 0 0', whiteSpace: 'pre-wrap' as const }
const button = { backgroundColor: '#d4a537', color: '#111111', padding: '12px 20px', borderRadius: '6px', fontWeight: 700, fontSize: '14px', marginLeft: '24px' }
const hr = { borderColor: '#e5e5e5', margin: '24px' }
const footer = { fontSize: '12px', color: '#888888', padding: '0 24px' }
