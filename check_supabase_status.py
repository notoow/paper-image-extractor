import os
import sys
from supabase import create_client

def check_supabase():
    # 환경 변수에서 키 읽기
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")

    if not url or not key:
        print("❌ 오류: SUPABASE_URL 또는 SUPABASE_KEY 환경 변수가 설정되지 않았습니다.")
        print("   -> set SUPABASE_URL=... 명령어로 설정해주세요.")
        return

    print(f"📡 Supabase 연결 확인 중... (URL: {url})")

    try:
        client = create_client(url, key)
        
        # 1. 테이블 목록 조회 (정보 스키마 활용)
        print("\n📋 테이블 상태 점검:")
        tables = [
            "paper_extractor_votes",
            "paper_extractor_chats",
            "paper_extractor_leaderboard",
            "paper_extractor_images",
            # 구버전 테이블도 있는지 확인
            "votes", "chats", "leaderboard", "images"
        ]

        for table_name in tables:
            try:
                # count="exact", head=True로 데이터 없이 존재 여부 및 개수만 확인
                res = client.table(table_name).select("*", count="exact", head=True).execute()
                print(f"  ✅ [존재함] {table_name:<30} (데이터 개수: {res.count})")
            except Exception as e:
                # 테이블이 없으면 에러가 발생함
                if "relation" in str(e) and "does not exist" in str(e):
                     print(f"  ⚠️ [없음]   {table_name:<30}")
                else:
                    print(f"  ❌ [오류]   {table_name:<30} -> {e}")

    except Exception as e:
        print(f"\n❌ Supabase 연결 실패: {e}")

if __name__ == "__main__":
    check_supabase()
