import { describe, it, expect } from 'vitest'
import { groupBySpeaker, speakerLabel, SpeakerTranscript } from '../hooks/speakerSegments'

describe('groupBySpeaker', () => {
  it('merges consecutive items from the same speaker', () => {
    expect(
      groupBySpeaker([
        { Content: 'hello', Speaker: '0', Type: 'pronunciation' },
        { Content: 'there', Speaker: '0', Type: 'pronunciation' },
      ]),
    ).toEqual([{ speaker: '0', text: 'hello there' }])
  })

  it('starts a new segment when the speaker changes', () => {
    expect(
      groupBySpeaker([
        { Content: 'hi', Speaker: '0', Type: 'pronunciation' },
        { Content: 'yo', Speaker: '1', Type: 'pronunciation' },
      ]),
    ).toEqual([
      { speaker: '0', text: 'hi' },
      { speaker: '1', text: 'yo' },
    ])
  })

  it('attaches punctuation with no leading space and never starts a new speaker', () => {
    expect(
      groupBySpeaker([
        { Content: 'hi', Speaker: '0', Type: 'pronunciation' },
        { Content: '.', Speaker: '1', Type: 'punctuation' },
      ]),
    ).toEqual([{ speaker: '0', text: 'hi.' }])
  })

  it('skips empty items', () => {
    expect(groupBySpeaker([{ Content: '', Speaker: '0' }])).toEqual([])
  })

  it('drops leading punctuation that has no segment to attach to', () => {
    expect(
      groupBySpeaker([
        { Content: '.', Speaker: '0', Type: 'punctuation' },
        { Content: 'hi', Speaker: '0', Type: 'pronunciation' },
      ]),
    ).toEqual([{ speaker: '0', text: 'hi' }])
  })

  it('falls back to "?" when an item carries no speaker id', () => {
    expect(groupBySpeaker([{ Content: 'word', Type: 'pronunciation' }])).toEqual([
      { speaker: '?', text: 'word' },
    ])
  })
})

describe('speakerLabel', () => {
  it('maps 0-based speaker ids to 1-based labels', () => {
    expect(speakerLabel('0')).toBe('Speaker 1')
    expect(speakerLabel('1')).toBe('Speaker 2')
  })

  it('passes a non-numeric speaker id through unchanged', () => {
    expect(speakerLabel('?')).toBe('Speaker ?')
  })
})

describe('SpeakerTranscript', () => {
  it('puts each speaker turn on its own labelled line', () => {
    const t = new SpeakerTranscript()
    t.append([{ Content: 'hello', Speaker: '0', Type: 'pronunciation' }])
    t.append([{ Content: 'hi', Speaker: '1', Type: 'pronunciation' }])
    expect(t.toString()).toBe('Speaker 1: hello\nSpeaker 2: hi')
  })

  it('continues the same speaker across appends without repeating the label', () => {
    const t = new SpeakerTranscript()
    t.append([{ Content: 'hello', Speaker: '0', Type: 'pronunciation' }])
    t.append([{ Content: 'again', Speaker: '0', Type: 'pronunciation' }])
    expect(t.toString()).toBe('Speaker 1: hello again')
  })
})
