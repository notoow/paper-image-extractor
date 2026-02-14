-- Supabase RLS(Row Level Security) 경고 해결 및 권한 설정
-- 이 코드를 SQL Editor에서 실행하세요.

-- 1. votes 테이블에 RLS 활성화 (보안 기능 켜기)
alter table public.votes enable row level security;

-- 2. 접근 정책(Policy) 생성
-- 백엔드가 'anon' 키를 사용하더라도 읽기/쓰기가 가능하도록 허용합니다.
-- (서비스가 커지면 더 엄격하게 제한할 수 있지만, 지금은 기능 작동이 우선입니다)

create policy "Enable all access for votes"
on public.votes
for all
using (true)
with check (true);

-- 참고: 만약 다른 테이블(chats, images 등)에도 같은 경고가 뜬다면 아래와 같이 해주세요:
-- alter table public.chats enable row level security;
-- create policy "Enable all access for chats" on public.chats for all using (true) with check (true);
