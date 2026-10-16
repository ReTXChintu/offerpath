import { normalizeSkill, skillGaps } from './skill-gaps';

const catalogue = [
  { id: 't-next', slug: 'nextjs', name: 'Next.js' },
  { id: 't-node', slug: 'nodejs', name: 'Node.js' },
  { id: 't-docker', slug: 'docker', name: 'Docker' },
];

describe('normalizeSkill', () => {
  it('treats spellings of the same skill alike', () => {
    expect(normalizeSkill('Node.js')).toBe(normalizeSkill('NodeJS'));
    expect(normalizeSkill('node js 18')).toBe(normalizeSkill('Node.js'));
    expect(normalizeSkill('React (hooks)')).toBe('react');
    expect(normalizeSkill('C++')).toBe('c++');
  });
});

describe('skillGaps', () => {
  it('ranks missing skills by how many best-match jobs ask for them', () => {
    const gaps = skillGaps(
      [
        { jobId: 'a', matchScore: 80, relevant: true, missingSkills: ['Next.js', 'Docker'] },
        { jobId: 'b', matchScore: 75, relevant: true, missingSkills: ['NextJS'] },
        { jobId: 'c', matchScore: 90, relevant: true, missingSkills: ['next.js', 'Kafka'] },
      ],
      catalogue,
    );

    expect(gaps[0]).toEqual({
      skill: 'Next.js',
      jobs: 3,
      technology: catalogue[0],
    });
    expect(gaps.map((g) => g.skill)).toEqual(['Next.js', 'Docker', 'Kafka']);
    // Not every skill is something the catalogue can teach.
    expect(gaps.find((g) => g.skill === 'Kafka')?.technology).toBeNull();
  });

  it('ignores weak matches and irrelevant jobs', () => {
    const gaps = skillGaps(
      [
        { jobId: 'a', matchScore: 30, relevant: true, missingSkills: ['Docker'] },
        { jobId: 'b', matchScore: 95, relevant: false, missingSkills: ['Docker'] },
        { jobId: 'c', missingSkills: ['Docker'] },
      ],
      catalogue,
    );
    expect(gaps).toEqual([]);
  });

  it('counts a job once even when it lists a skill twice', () => {
    const gaps = skillGaps(
      [{ jobId: 'a', matchScore: 80, missingSkills: ['Docker', 'docker'] }],
      catalogue,
    );
    expect(gaps).toEqual([{ skill: 'Docker', jobs: 1, technology: catalogue[2] }]);
  });
});
