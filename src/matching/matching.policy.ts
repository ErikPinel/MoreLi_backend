import { Injectable } from '@nestjs/common';
import { Database } from '../database/database.types.js';

type TeacherProfile = Database['public']['Functions']['search_teacher_candidates_v2']['Returns'][number];

export type MatchScores = {
  teacher_id: string;
  score: number;
  rank: number;
  subject_score: number;
  availability_score: number;
  location_score: number;
  budget_score: number;
  quality_score: number;
};

export type MatchContext = {
  cityId: number | null;
  budgetMin: number | null;
  budgetMax: number | null;
  availableTeacherIds: Set<string>;
};

@Injectable()
export class MatchingPolicy {
  rank(candidates: TeacherProfile[], context: MatchContext): MatchScores[] {
    const scored = candidates.map((teacher) => this.score(teacher, context));
    scored.sort((left, right) => {
      const leftTeacher = candidates.find((item) => item.id === left.teacher_id)!;
      const rightTeacher = candidates.find((item) => item.id === right.teacher_id)!;
      return (
        right.score - left.score ||
        rightTeacher.average_rating - leftTeacher.average_rating ||
        rightTeacher.review_count - leftTeacher.review_count ||
        left.teacher_id.localeCompare(right.teacher_id)
      );
    });
    return scored.slice(0, 5).map((match, index) => ({
      ...match,
      rank: index + 1,
    }));
  }

  private score(teacher: TeacherProfile, context: MatchContext): MatchScores {
    const subjectScore = 100;
    const availabilityScore = context.availableTeacherIds.has(teacher.id) ? 100 : 40;
    const locationScore = context.cityId === null || teacher.teaches_in_person ? 100 : 80;
    const budgetScore = this.budgetScore(teacher.hourly_price, context);
    const qualityScore = Math.min(
      100,
      (teacher.average_rating / 5) * 70 +
        teacher.response_rate * 0.2 +
        (teacher.verification_status === 'verified' ? 10 : 0),
    );
    const explorationBonus = this.isNewTeacher(teacher) ? 3 : 0;
    const score = Math.min(
      100,
      subjectScore * 0.3 +
        availabilityScore * 0.2 +
        locationScore * 0.15 +
        budgetScore * 0.15 +
        qualityScore * 0.2 +
        explorationBonus,
    );

    return {
      teacher_id: teacher.id,
      score: this.round(score),
      rank: 0,
      subject_score: subjectScore,
      availability_score: availabilityScore,
      location_score: locationScore,
      budget_score: budgetScore,
      quality_score: this.round(qualityScore),
    };
  }

  private budgetScore(price: number, context: MatchContext): number {
    if (context.budgetMin === null && context.budgetMax === null) return 100;
    const minimum = context.budgetMin ?? 0;
    const maximum = context.budgetMax ?? Math.max(minimum, price);
    if (maximum === minimum) return price === minimum ? 100 : 70;
    const midpoint = (minimum + maximum) / 2;
    return this.round(100 - (Math.abs(price - midpoint) / (maximum - minimum)) * 30);
  }

  private isNewTeacher(teacher: TeacherProfile): boolean {
    const age = Date.now() - new Date(teacher.created_at).getTime();
    return teacher.review_count < 3 && age <= 30 * 24 * 60 * 60 * 1000;
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}