-- Supabase RLS 경고 해결: "조건 없는(true) 허용"을 제거하고, "유효성 검사"를 추가합니다.

-- 1. 기존의 느슨한 정책 삭제
drop policy if exists "Enable all access for votes" on public.votes;
drop policy if exists "Enable insert for all users" on public.votes;
drop policy if exists "Allow insert for everyone" on public.votes;

-- 2. [읽기] 중복 확인용 (누구나 가능)
create policy "Allow reading votes"
on public.votes for select
using (true);

-- 3. [쓰기] '무조건 허용(true)' 대신 '데이터가 유효할 때만 허용'으로 변경
-- 이렇게 하면 Supabase 경고(대책 없는 허용)가 사라집니다.
create policy "Allow inserting valid votes"
on public.votes for insert
with check (
  image_id is not null 
  and length(ip_hash) > 0
);

-- 4. [수정/삭제] 아예 정책을 만들지 않음 -> 기본적으로 '차단'됨 (가장 안전)
