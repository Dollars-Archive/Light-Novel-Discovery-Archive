# 라노벨 등록 지침

사용자가 지정한 작품을 조사해 main의 docs/data/games.json 안 novels 배열에 등록합니다. templates/novel-entry.json을 기준으로 최신 JSON과 SHA를 읽고 해당 항목만 추가·수정합니다. 기존 ID와 다른 작품을 보존합니다.

- 국내 정발은 publication.status에 licensed(정발), unlicensed(미정발), unknown(미확인)을 사용합니다. 한국 출판사·발매 권수·확인일을 함께 기록합니다. 검색 실패만으로 미정발을 단정하지 않습니다.
- 원작 완결은 completion.status에 completed, ongoing, hiatus, unknown을 사용하고 권수를 함께 기록합니다. 원작 완결과 한국판 발매 완료를 각각 기록합니다.
- summary는 스포일러 없는 스토리 개요입니다. author와 genres를 작성합니다.
- score는 0~10 숫자 또는 null입니다. 자료 기반 평가라는 점과 구체적인 장단점을 적습니다. 확인하지 않은 직접 독서나 매체 평균을 만들지 않습니다. 미평가는 null로 두며 0점을 대신 쓰지 않습니다.
- 출판사와 작품 공식 안내, 관련 리뷰 등 필요한 출처만 확인하고 sources에 label과 url을 남깁니다. reviewedAt은 평가 확인일 YYYY-MM-DD입니다.
- cover.url에는 해당 작품의 공식 표지 직접 이미지 URL, cover.source에는 출처 페이지 URL을 넣습니다. 실제 판본을 확인하고 표지 비율을 보존합니다.
- 데이터만 등록하는 작업은 사이트 코드나 watchlist-data 브랜치의 찜·삭제 파일을 변경하지 않습니다.
- 사용 가능한 GitHub 쓰기 도구로 저장하고 다시 읽어 확인합니다. 쓰기 도구가 없으면 JSON을 제공하고 등록 대기라고 알립니다.

찜·삭제 열쇠에는 Light-Novel-Discovery-Archive 저장소의 Contents Read and write 권한을 허용합니다. 각 브라우저에 등록하며 키는 공개 데이터에 넣지 않습니다.
