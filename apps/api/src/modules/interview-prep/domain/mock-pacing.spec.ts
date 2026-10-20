import { MAX_ANSWERS, pace, settle, type PacingTurn, type Stage } from './mock-pacing.js';

const asked = (stage: Stage, kind: string): PacingTurn => ({ speaker: 'INTERVIEWER', stage, kind });
const answer = (stage: Stage): PacingTurn => ({ speaker: 'CANDIDATE', stage, kind: 'ANSWER' });

describe('mock interview pacing', () => {
  it('lets the intro follow up twice, then moves on to technical questions', () => {
    const turns = [asked('INTRO', 'OPENING'), answer('INTRO')];
    const first = pace(turns, 'INTRO', false);
    expect(first.canFollowUp).toBe(true);
    expect(first.canAdvance).toBe(true);
    expect(first.mustAdvance).toBe(false);
    expect(first.directive).toContain('FOLLOW_UP');

    turns.push(asked('INTRO', 'FOLLOW_UP'), answer('INTRO'));
    turns.push(asked('INTRO', 'CROSS_QUESTION'), answer('INTRO'));
    const done = pace(turns, 'INTRO', false);
    expect(done.mustAdvance).toBe(true);
    expect(done.directive).toContain('move on now');
    expect(done.directive).toContain('stage TECHNICAL');
  });

  it('counts follow-ups per main question, not per stage', () => {
    const turns = [
      asked('TECHNICAL', 'NEW_QUESTION'),
      answer('TECHNICAL'),
      asked('TECHNICAL', 'FOLLOW_UP'),
      answer('TECHNICAL'),
      asked('TECHNICAL', 'FOLLOW_UP'),
      answer('TECHNICAL'),
      asked('TECHNICAL', 'NEW_QUESTION'),
      answer('TECHNICAL'),
    ];
    const p = pace(turns, 'TECHNICAL', false);
    expect(p.mainAsked).toBe(2);
    expect(p.followUpsOnCurrent).toBe(0);
    expect(p.canFollowUp).toBe(true);
    expect(p.canAskNew).toBe(true);
    expect(p.canAdvance).toBe(false);
  });

  it('gives two coding problems with DSA and one without', () => {
    const turns = [asked('CODING', 'CODING'), answer('CODING')];
    expect(pace(turns, 'CODING', true).canAskNew).toBe(true);
    expect(pace(turns, 'CODING', false).canAskNew).toBe(false);
  });

  it('closes the wrap-up after one exchange, and any interview after the answer cap', () => {
    const wrap = [asked('WRAP_UP', 'NEW_QUESTION'), answer('WRAP_UP')];
    expect(pace(wrap, 'WRAP_UP', false).mustClose).toBe(false);
    wrap.push(asked('WRAP_UP', 'FOLLOW_UP'), answer('WRAP_UP'));
    expect(pace(wrap, 'WRAP_UP', false).mustClose).toBe(true);

    const long: PacingTurn[] = [];
    for (let i = 0; i < MAX_ANSWERS; i++)
      long.push(asked('TECHNICAL', 'FOLLOW_UP'), answer('TECHNICAL'));
    const capped = pace(long, 'TECHNICAL', false);
    expect(capped.mustClose).toBe(true);
    expect(settle(capped, { kind: 'FOLLOW_UP', stage: 'TECHNICAL', hasProblem: false })).toEqual({
      kind: 'CLOSING',
      stage: 'TECHNICAL',
      closing: true,
      forcedClose: true,
    });
  });

  describe('settling what the AI proposed', () => {
    const intro = pace([asked('INTRO', 'OPENING'), answer('INTRO')], 'INTRO', false);
    const technical = pace(
      [asked('TECHNICAL', 'NEW_QUESTION'), answer('TECHNICAL')],
      'TECHNICAL',
      true,
    );

    it('never goes back or jumps more than one stage', () => {
      expect(settle(technical, { kind: 'FOLLOW_UP', stage: 'INTRO', hasProblem: false })).toEqual(
        expect.objectContaining({ stage: 'TECHNICAL', kind: 'FOLLOW_UP' }),
      );
      expect(settle(intro, { kind: 'CODING', stage: 'CODING', hasProblem: true })).toEqual(
        expect.objectContaining({ stage: 'TECHNICAL', kind: 'NEW_QUESTION' }),
      );
    });

    it('makes the first turn of the coding round a CODING turn', () => {
      expect(
        settle(technical, { kind: 'NEW_QUESTION', stage: 'CODING', hasProblem: true }),
      ).toEqual(expect.objectContaining({ stage: 'CODING', kind: 'CODING', closing: false }));
    });

    it('does not let the interview end during the intro or technical questions', () => {
      expect(settle(intro, { kind: 'CLOSING', stage: 'INTRO', hasProblem: false })).toEqual(
        expect.objectContaining({ closing: false, kind: 'NEW_QUESTION' }),
      );
      const wrap = pace([asked('WRAP_UP', 'NEW_QUESTION'), answer('WRAP_UP')], 'WRAP_UP', false);
      expect(settle(wrap, { kind: 'CLOSING', stage: 'WRAP_UP', hasProblem: false })).toEqual({
        kind: 'CLOSING',
        stage: 'WRAP_UP',
        closing: true,
        forcedClose: false,
      });
    });
  });
});
