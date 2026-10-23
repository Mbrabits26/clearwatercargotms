import * as React from 'react'
import { Body, Container, Head, Heading, Hr, Html, Preview, Section, Text } from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  rc?: string
  lane?: string
  carrier?: string
  pickup?: string
  brokerName?: string
  brokerEmail?: string
}

const Email = ({ rc = '', lane, carrier, pickup, brokerName, brokerEmail }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`Load RC #${rc} has been reassigned — please do not dispatch`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={band}><Text style={brand}>CLEARWATER CARGO</Text></Section>
        <Heading style={h1}>Removed from load — RC #{rc}</Heading>
        <Text style={text}>
          {carrier ? `${carrier}, you` : 'You'} have been removed from this load. Rate confirmation RC #{rc} is cancelled and no longer valid.
        </Text>
        <Text style={warn}>Please do not dispatch a truck or pick up this load.</Text>
        <Section style={box}>
          {lane ? <Text style={row}><b>Lane:</b> {lane}</Text> : null}
          {pickup ? <Text style={row}><b>Pickup:</b> {pickup}</Text> : null}
          <Text style={row}><b>Rate con:</b> RC #{rc} — cancelled</Text>
        </Section>
        <Text style={text}>
          Questions? Contact {brokerName ?? 'your Clearwater Cargo broker'}{brokerEmail ? ` at ${brokerEmail}` : ''} or call 252-497-7916. Thank you, and we look forward to working with you on future loads.
        </Text>
        <Hr style={hr} />
        <Text style={footer}>Clearwater Cargo LLC · Staley, NC · 252-497-7916</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => `Load cancelled for your company — RC #${d.rc ?? ''}`,
  displayName: 'Carrier removed from load',
  previewData: { rc: '10452', lane: 'Raleigh, NC → Atlanta, GA', carrier: 'Acme Trucking', pickup: 'Oct 24, 2026', brokerName: 'Michael Brabits', brokerEmail: 'michael@clearwatercargo.com' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '0 0 20px', maxWidth: '560px' }
const band = { backgroundColor: '#0b3b3c', padding: '14px 24px' }
const brand = { color: '#d4a537', fontSize: '18px', fontWeight: 700, letterSpacing: '2px', margin: 0 }
const h1 = { fontSize: '22px', color: '#111111', padding: '0 24px', margin: '20px 0 8px' }
const text = { fontSize: '14px', color: '#333333', padding: '0 24px', lineHeight: '22px' }
const warn = { fontSize: '14px', color: '#9a1c1c', fontWeight: 700, padding: '0 24px' }
const box = { margin: '8px 24px 16px', padding: '12px 16px', border: '1px solid #e5e5e5', borderRadius: '6px' }
const row = { fontSize: '14px', color: '#333333', margin: '4px 0' }
const hr = { borderColor: '#e5e5e5', margin: '24px' }
const footer = { fontSize: '12px', color: '#888888', padding: '0 24px' }
