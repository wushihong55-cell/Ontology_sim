import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { Skill } from '../types'

const SKILLS_KEY = ['skills']

export function useSkills() {
  return useQuery<Skill[]>({
    queryKey: SKILLS_KEY,
    queryFn: () => api.getSkills() as Promise<Skill[]>,
    staleTime: 60_000,
  })
}

export function useToggleSkill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.updateSkill(id, { enabled }),
    onMutate: async ({ id, enabled }) => {
      await qc.cancelQueries({ queryKey: SKILLS_KEY })
      const prev = qc.getQueryData<Skill[]>(SKILLS_KEY)
      qc.setQueryData<Skill[]>(SKILLS_KEY, (old) =>
        old?.map((s) => (s.id === id ? { ...s, enabled } : s)) ?? [],
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(SKILLS_KEY, ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: SKILLS_KEY }),
  })
}

export function useSaveSkill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (skill: Partial<Skill> & { id?: string }) =>
      skill.id
        ? api.updateSkill(skill.id, skill)
        : api.createSkill(skill),
    onSuccess: () => qc.invalidateQueries({ queryKey: SKILLS_KEY }),
  })
}

export function useDeleteSkill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteSkill(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: SKILLS_KEY })
      const prev = qc.getQueryData<Skill[]>(SKILLS_KEY)
      qc.setQueryData<Skill[]>(SKILLS_KEY, (old) => old?.filter((s) => s.id !== id) ?? [])
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(SKILLS_KEY, ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: SKILLS_KEY }),
  })
}

export function useImportSkill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (skill: Omit<Skill, 'id'> & { id?: string }) =>
      api.createSkill({ ...skill, isBuiltIn: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: SKILLS_KEY }),
  })
}
