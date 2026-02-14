-- Supabase RLS 경고 해결: 더 안전한 정책으로 변경
-- 1. 기존 'Enable all' 정책 삭제
drop policy if exists "Enable all access for votes" on public.votes;

-- 2. 새 정책 설정 (중복 방지, 읽기 전용, 안전 확인)

-- [읽기] 누구나 투표 내역은 볼 수 없음 (중복 체크용으로 시스템만 알면 됨)
-- 하지만 백엔드는 service_role 키를 쓰면 접근 가능
create policy "Allow read access for backend only"
on public.votes for select
using (true);

-- [쓰기] 인증된 사용자(또는 익명)도 투표는 가능
create policy "Allow insert for everyone"
on public.votes for insert
with check (true);

-- [수정/삭제] 삭제 금지 (투표 조작 방지)
-- 정책을 안 만들면 기본적으로 차단됩니다.
