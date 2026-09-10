FROM postgis/postgis:16-3.4
# pgvector for semantic search / RAG retrieval (Phase 6).
#
# The pgvector .deb requires a postgresql-16 upgrade whose 41MB apt chain is
# flaky on slow links, so the three debs are vendored in ./debs/ (pinned
# versions, see debs/SOURCES.txt) and installed offline with dpkg instead of
# apt-get. To refresh: re-download per debs/SOURCES.txt and rebuild.
COPY debs/*.deb /tmp/debs/
# Order matters: upgrade postgresql-16 first (pgvector breaks the old -jit-llvm).
RUN dpkg -i /tmp/debs/libllvm16.deb /tmp/debs/postgresql-16.deb \
 && dpkg -i /tmp/debs/postgresql-16-pgvector.deb \
 && rm -rf /tmp/debs
